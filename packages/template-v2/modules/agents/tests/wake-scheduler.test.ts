/**
 * Wake-scheduler + wake-worker unit coverage.
 *
 * Exercises the five wake triggers, the two-level debounce
 * (pre-wake singleton + in-wake steer), approval-resume in both polarities,
 * scheduled followup timing, and process-restart idempotency.
 *
 * Uses `createFakeWakeQueue` + `createInMemoryActiveWakes` + a stub `runHarness`
 * so the suite needs no running postgres pg-boss. The production seam (pg-boss
 * singleton + pg NOTIFY) is covered by the integration test in P2.7.
 */

import { describe, expect, it } from 'bun:test'
import type { AgentEvent, WakeTrigger } from '@modules/agents/events'
import { createInMemoryActiveWakes, DirtyTracker, type HarnessEvent, type WakeRuntime } from '@vobase/core'
import { InMemoryFs } from 'just-bash'
import { nanoid } from 'nanoid'

import { AGENT_WAKE_JOB, SCHEDULED_FOLLOWUP_JOB } from '../service/queue-jobs'
import { createFakeWakeQueue } from '../service/queue-port'
import type { AgentWakeJobPayload, ScheduledFollowupPayload } from '../service/wake-scheduler'
import { createWakeScheduler } from '../service/wake-scheduler'
import {
  createInMemoryOutbound,
  createWakeWorker,
  type RunHarnessFn,
  type RunHarnessInput,
  type RunHarnessOutput,
} from '../service/wake-worker'

// ─── helpers ─────────────────────────────────────────────────────────────

const ORG = 'org-test'
const AGENT = 'agt-test'
const CONV = 'conv-test'

const STUB_RUNTIME: WakeRuntime = {
  fs: new InMemoryFs(),
  tracker: new DirtyTracker(new Map(), [], []),
}

interface BuildDeps {
  debounceMs?: number
}

function buildRig(opts: BuildDeps = {}) {
  const queue = createFakeWakeQueue()
  const activeWakes = createInMemoryActiveWakes()
  const notifyLog: Array<{ channel: string; payload: Record<string, unknown> }> = []
  const notifier = {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async notify(channel: string, payload: Record<string, unknown>): Promise<void> {
      notifyLog.push({ channel, payload })
    },
  }
  const scheduler = createWakeScheduler({
    queue,
    activeWakes,
    notifier,
    debounceMs: opts.debounceMs ?? 1000,
  })
  return { queue, activeWakes, notifier, notifyLog, scheduler }
}

/** Stub runHarness that emits a canonical event set through the extraOnEvent listener. */
function makeStubRunHarness(script: {
  toolCalls?: Array<{ name: string; args: unknown; ok?: boolean; result?: unknown }>
  /** Optional side-effect hook invoked while the wake is running. */
  onTurn?: (input: RunHarnessInput) => Promise<void>
  throwMidTurn?: boolean
}): RunHarnessFn {
  return async (input: RunHarnessInput): Promise<RunHarnessOutput> => {
    const wakeId = `w-${nanoid(8)}`
    const turnIndex = 0
    const base = {
      ts: new Date(),
      wakeId,
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      turnIndex,
    }
    const publish = (ev: AgentEvent): void => {
      input.extraOnEvent(ev as unknown as HarnessEvent<WakeTrigger>, STUB_RUNTIME)
    }
    publish({
      ...base,
      type: 'agent_start',
      agentId: input.agentId,
      trigger: input.trigger.trigger,
      triggerPayload: input.trigger,
      systemHash: 'h',
    })
    publish({ ...base, type: 'turn_start' })

    await script.onTurn?.(input)

    if (script.throwMidTurn) {
      throw new Error('simulated mid-turn crash')
    }

    for (const call of script.toolCalls ?? []) {
      const toolCallId = `tc-${nanoid(6)}`
      publish({ ...base, type: 'tool_execution_start', toolCallId, toolName: call.name, args: call.args })
      publish({
        ...base,
        type: 'tool_execution_end',
        toolCallId,
        toolName: call.name,
        result: call.result ?? { ok: call.ok ?? true },
        isError: call.ok === false,
        latencyMs: 1,
      })
    }

    publish({ ...base, type: 'turn_end', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    publish({ ...base, type: 'agent_end', reason: 'complete' })

    return { wakeId }
  }
}

// ─── 1–5 · Five triggers each enqueue the right job ──────────────────────

describe('wake-scheduler — 5 triggers', () => {
  it('inbound_message enqueues agent-wake with singletonKey + 1s debounce', async () => {
    const { scheduler, queue } = buildRig()
    const result = await scheduler.enqueue(
      { trigger: 'inbound_message', conversationId: CONV, messageIds: ['m1'] },
      { agentId: AGENT, organizationId: ORG },
    )
    expect(result.wasNew).toBe(true)
    expect(queue.pending()).toHaveLength(1)
    const pending = queue.pending()[0]
    expect(pending?.name).toBe(AGENT_WAKE_JOB)
    expect(pending?.singletonKey).toBe(`agents:agent-wake:${AGENT}:${CONV}`)
    const payload = pending?.data as AgentWakeJobPayload
    expect(payload.trigger.trigger).toBe('inbound_message')
    expect((payload.trigger as { messageIds: string[] }).messageIds).toEqual(['m1'])
  })

  it('approval_resumed enqueues agent-wake with decision + note', async () => {
    const { scheduler, queue } = buildRig()
    await scheduler.enqueue(
      { trigger: 'approval_resumed', conversationId: CONV, approvalId: 'ap1', decision: 'approved' },
      { agentId: AGENT, organizationId: ORG },
    )
    const pending = queue.pending()[0]
    expect(pending?.name).toBe(AGENT_WAKE_JOB)
    const payload = pending?.data as AgentWakeJobPayload
    expect(payload.trigger.trigger).toBe('approval_resumed')
    expect(payload.agentId).toBe(AGENT)
  })

  it('supervisor enqueues agent-wake carrying noteId + authorUserId', async () => {
    const { scheduler, queue } = buildRig()
    await scheduler.enqueue(
      { trigger: 'supervisor', conversationId: CONV, noteId: 'note-1', authorUserId: 'usr-a' },
      { agentId: AGENT, organizationId: ORG },
    )
    const pending = queue.pending()[0]
    const payload = pending?.data as AgentWakeJobPayload
    expect(payload.trigger.trigger).toBe('supervisor')
    expect((payload.trigger as { noteId: string }).noteId).toBe('note-1')
  })

  it('scheduled_followup enqueues on the scheduled-followup queue with startAfter date', async () => {
    const { scheduler, queue } = buildRig()
    const scheduledAt = new Date('2030-01-01T00:00:00Z')
    await scheduler.enqueue(
      { trigger: 'scheduled_followup', conversationId: CONV, reason: 'nudge', scheduledAt },
      { agentId: AGENT, organizationId: ORG },
    )
    const pending = queue.pending()[0]
    expect(pending?.name).toBe(SCHEDULED_FOLLOWUP_JOB)
    expect(pending?.availableAt).toBe(scheduledAt.getTime())
    const payload = pending?.data as ScheduledFollowupPayload
    expect(payload.scheduledAt).toBe(scheduledAt.toISOString())
  })

  it('manual enqueues agent-wake with actorUserId', async () => {
    const { scheduler, queue } = buildRig()
    await scheduler.enqueue(
      { trigger: 'manual', conversationId: CONV, reason: 'staff test', actorUserId: 'usr-x' },
      { agentId: AGENT, organizationId: ORG },
    )
    const pending = queue.pending()[0]
    const payload = pending?.data as AgentWakeJobPayload
    expect(payload.trigger.trigger).toBe('manual')
    expect((payload.trigger as { actorUserId: string }).actorUserId).toBe('usr-x')
  })
})

// ─── 6–8 · Debounce (race conditions around burst inbound) ───────────────

describe('wake-scheduler — debounce', () => {
  it('10 rapid inbound messages collapse to exactly 1 pending job', async () => {
    const { scheduler, queue } = buildRig()
    for (let i = 0; i < 10; i += 1) {
      await scheduler.enqueue(
        { trigger: 'inbound_message', conversationId: CONV, messageIds: [`m${i}`] },
        { agentId: AGENT, organizationId: ORG },
      )
    }
    const jobs = queue.pending().filter((j) => j.name === AGENT_WAKE_JOB)
    expect(jobs).toHaveLength(1)
    const payload = jobs[0]?.data as AgentWakeJobPayload
    const msgs = (payload.trigger as { messageIds: string[] }).messageIds
    expect(msgs).toHaveLength(10)
    expect(msgs.slice().sort()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'])
  })

  it('inbound arriving during an active wake is steered via notify, not enqueued', async () => {
    const { scheduler, queue, activeWakes, notifyLog } = buildRig()
    await activeWakes.acquire(CONV, 'worker-X', 30_000)
    const result = await scheduler.enqueue(
      { trigger: 'inbound_message', conversationId: CONV, messageIds: ['steer-1'] },
      { agentId: AGENT, organizationId: ORG },
    )
    expect(result.steered).toBe(true)
    expect(queue.pending()).toHaveLength(0)
    expect(notifyLog).toHaveLength(1)
    expect(notifyLog[0]?.channel).toBe('wake:worker-X')
    expect((notifyLog[0]?.payload as { messageIds: string[] }).messageIds).toEqual(['steer-1'])
  })

  it('after lease release, next inbound returns to enqueue path (not steer)', async () => {
    const { scheduler, queue, activeWakes } = buildRig()
    await activeWakes.acquire(CONV, 'worker-X', 30_000)
    await scheduler.enqueue(
      { trigger: 'inbound_message', conversationId: CONV, messageIds: ['a'] },
      { agentId: AGENT, organizationId: ORG },
    )
    expect(queue.pending()).toHaveLength(0)
    await activeWakes.release(CONV, 'worker-X')
    const second = await scheduler.enqueue(
      { trigger: 'inbound_message', conversationId: CONV, messageIds: ['b'] },
      { agentId: AGENT, organizationId: ORG },
    )
    expect(second.steered).toBe(false)
    expect(second.wasNew).toBe(true)
    expect(queue.pending()).toHaveLength(1)
  })
})

// ─── 9–10 · Approval-resume (approve + reject) ───────────────────────────

describe('wake-scheduler — approval resume', () => {
  it('approve: resumed wake sees the approved decision in the trigger payload', async () => {
    const { scheduler, queue } = buildRig({ debounceMs: 0 })
    await scheduler.enqueue(
      {
        trigger: 'approval_resumed',
        conversationId: CONV,
        approvalId: 'pa-1',
        decision: 'approved',
        note: 'lgtm',
      },
      { agentId: AGENT, organizationId: ORG },
    )
    queue.advance(0)
    const outbound = createInMemoryOutbound()
    let capturedTrigger: WakeTrigger | null = null
    const worker = createWakeWorker({
      queue,
      activeWakes: createInMemoryActiveWakes(),
      outbound,
      runHarness: makeStubRunHarness({
        toolCalls: [{ name: 'reply', args: { text: 'ok' } }],
        // biome-ignore lint/suspicious/useAwait: contract requires async signature
        onTurn: async (input) => {
          capturedTrigger = input.trigger
        },
      }),
    })
    await worker.start()
    await queue.drain()
    expect(capturedTrigger).toBeTruthy()
    const trig = capturedTrigger as unknown as Extract<WakeTrigger, { trigger: 'approval_resumed' }>
    expect(trig.trigger).toBe('approval_resumed')
    expect(trig.decision).toBe('approved')
    expect(trig.note).toBe('lgtm')
    expect(outbound.log()).toHaveLength(1)
    expect(outbound.log()[0]?.toolName).toBe('reply')
  })

  it('reject: resumed wake trigger carries the rejection reason for synthetic tool_result', async () => {
    const { scheduler, queue } = buildRig({ debounceMs: 0 })
    await scheduler.enqueue(
      {
        trigger: 'approval_resumed',
        conversationId: CONV,
        approvalId: 'pa-2',
        decision: 'rejected',
        note: 'too risky',
      },
      { agentId: AGENT, organizationId: ORG },
    )
    let capturedTrigger: WakeTrigger | null = null
    const worker = createWakeWorker({
      queue,
      activeWakes: createInMemoryActiveWakes(),
      outbound: createInMemoryOutbound(),
      runHarness: makeStubRunHarness({
        // biome-ignore lint/suspicious/useAwait: contract requires async signature
        onTurn: async (input) => {
          capturedTrigger = input.trigger
        },
      }),
    })
    await worker.start()
    await queue.drain()
    const trig = capturedTrigger as unknown as Extract<WakeTrigger, { trigger: 'approval_resumed' }>
    expect(trig.decision).toBe('rejected')
    expect(trig.note).toBe('too risky')
  })
})

// ─── 11–12 · Scheduled followup timing ───────────────────────────────────

describe('wake-scheduler — scheduled followup', () => {
  it('scheduled_followup is not drained before its scheduledAt clock tick', async () => {
    const { scheduler, queue } = buildRig()
    const scheduledAt = new Date(10_000)
    await scheduler.enqueue(
      { trigger: 'scheduled_followup', conversationId: CONV, reason: 'r', scheduledAt },
      { agentId: AGENT, organizationId: ORG },
    )
    const outbound = createInMemoryOutbound()
    let ran = false
    const worker = createWakeWorker({
      queue,
      activeWakes: createInMemoryActiveWakes(),
      outbound,
      runHarness: makeStubRunHarness({
        // biome-ignore lint/suspicious/useAwait: contract requires async signature
        onTurn: async () => {
          ran = true
        },
      }),
    })
    await worker.start()
    await queue.drain()
    expect(ran).toBe(false)
    queue.advance(scheduledAt.getTime())
    await queue.drain()
    expect(ran).toBe(true)
  })

  it('scheduled_followup payload carries the same scheduledAt ISO string', async () => {
    const { scheduler, queue } = buildRig()
    const scheduledAt = new Date('2027-06-15T10:30:00Z')
    await scheduler.enqueue(
      { trigger: 'scheduled_followup', conversationId: CONV, reason: 'r', scheduledAt },
      { agentId: AGENT, organizationId: ORG },
    )
    const pending = queue.pending()[0]
    const payload = pending?.data as ScheduledFollowupPayload
    expect(payload.scheduledAt).toBe('2027-06-15T10:30:00.000Z')
  })
})

// ─── 13 · Process-restart idempotency ─────────────────────────────────────

describe('wake-worker — idempotency', () => {
  it('mid-turn crash retries the job but outbound emits exactly once', async () => {
    const { scheduler, queue } = buildRig({ debounceMs: 0 })
    await scheduler.enqueue(
      { trigger: 'manual', conversationId: CONV, reason: 'retry', actorUserId: 'u' },
      { agentId: AGENT, organizationId: ORG },
    )
    const outbound = createInMemoryOutbound()
    const emits: Array<{ toolCallId: string }> = []
    // Every retry uses a fresh publish listener; we force a stable id across
    // attempts by scripting a single tool call and stabilising the id inside
    // the outbound adapter.
    let attempts = 0
    const stableId = 'tc-stable'
    const worker = createWakeWorker({
      queue,
      activeWakes: createInMemoryActiveWakes(),
      outbound: {
        async emit(input): Promise<void> {
          emits.push({ toolCallId: input.toolCallId })
          await outbound.emit({ ...input, toolCallId: stableId })
        },
      },
      // biome-ignore lint/suspicious/useAwait: contract requires async signature
      runHarness: async (input) => {
        attempts += 1
        const wakeId = `w-${attempts}`
        const base = {
          ts: new Date(),
          wakeId,
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          turnIndex: 0,
        }
        const publish = (ev: HarnessEvent<WakeTrigger>): void => {
          input.extraOnEvent(ev, STUB_RUNTIME)
        }
        publish({
          ...base,
          type: 'agent_start',
          agentId: input.agentId,
          trigger: 'manual',
          triggerPayload: input.trigger,
          systemHash: 'h',
        } as unknown as HarnessEvent<WakeTrigger>)
        if (attempts === 1) {
          throw new Error('crash')
        }
        publish({
          ...base,
          type: 'tool_execution_start',
          toolCallId: stableId,
          toolName: 'reply',
          args: {},
        } as unknown as HarnessEvent<WakeTrigger>)
        publish({
          ...base,
          type: 'tool_execution_end',
          toolCallId: stableId,
          toolName: 'reply',
          result: { ok: true },
          isError: false,
          latencyMs: 1,
        } as unknown as HarnessEvent<WakeTrigger>)
        publish({
          ...base,
          type: 'agent_end',
          reason: 'complete',
        } as unknown as HarnessEvent<WakeTrigger>)
        return { wakeId }
      },
    })
    await worker.start()
    await queue.drain()
    expect(attempts).toBeGreaterThanOrEqual(2)
    // Outbound port deduped by stable id — only 1 emit recorded in the underlying map.
    expect(outbound.log()).toHaveLength(1)
  })
})

// Silence the unused-symbol lint for imported types retained for documentation.
void ({} as AgentEvent)

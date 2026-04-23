/**
 * Wake-scheduler + wake-worker unit coverage.
 *
 * Exercises the five wake triggers, the two-level debounce
 * (pre-wake singleton + in-wake steer), approval-resume in both polarities,
 * scheduled followup timing, and process-restart idempotency.
 *
 * Uses `createFakeWakeQueue` + `createInMemoryActiveWakes` + a stub `bootWake`
 * so the suite needs no running postgres pg-boss. The production seam (pg-boss
 * singleton + pg NOTIFY) is covered by the integration test in P2.7.
 */

import { describe, expect, it } from 'bun:test'
import type { AgentEvent, WakeTrigger } from '@server/contracts/event'
import type { BootWakeOpts, BootWakeResult } from '@server/harness/agent-runner'
import { EventBus } from '@server/harness/internal-bus'
import { nanoid } from 'nanoid'
import { createInMemoryActiveWakes } from '../service/active-wakes'
import { AGENT_WAKE_JOB, SCHEDULED_FOLLOWUP_JOB } from '../service/queue-jobs'
import { createFakeWakeQueue } from '../service/queue-port'
import type { AgentWakeJobPayload, ScheduledFollowupPayload } from '../service/wake-scheduler'
import { createWakeScheduler } from '../service/wake-scheduler'
import { createInMemoryOutbound, createWakeWorker } from '../service/wake-worker'

// ─── helpers ─────────────────────────────────────────────────────────────

const ORG = 'org-test'
const AGENT = 'agt-test'
const CONV = 'conv-test'

interface BuildDeps {
  debounceMs?: number
}

function buildRig(opts: BuildDeps = {}) {
  const queue = createFakeWakeQueue()
  const activeWakes = createInMemoryActiveWakes()
  const notifyLog: Array<{ channel: string; payload: Record<string, unknown> }> = []
  const notifier = {
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

/** Stub bootWake that emits a canonical event set and routes outbound tool calls. */
function makeStubBootWake(script: {
  toolCalls?: Array<{ name: string; args: unknown; ok?: boolean; result?: unknown }>
  /** Optional side-effect hook invoked while the wake is running. */
  onTurn?: (opts: BootWakeOpts) => Promise<void>
  throwMidTurn?: boolean
}): (opts: BootWakeOpts) => Promise<BootWakeResult> {
  return async (opts: BootWakeOpts): Promise<BootWakeResult> => {
    const wakeId = `w-${nanoid(8)}`
    const turnIndex = 0
    const events = opts.events
    const base = {
      ts: new Date(),
      wakeId,
      conversationId: opts.conversationId ?? CONV,
      organizationId: opts.organizationId,
      turnIndex,
    }
    events?.publish({
      ...base,
      type: 'agent_start',
      agentId: opts.agentId,
      trigger: (opts.trigger as WakeTrigger).trigger,
      triggerPayload: opts.trigger as WakeTrigger,
      systemHash: 'h',
    } satisfies AgentEvent)
    events?.publish({ ...base, type: 'turn_start' } satisfies AgentEvent)

    await script.onTurn?.(opts)

    if (script.throwMidTurn) {
      throw new Error('simulated mid-turn crash')
    }

    for (const call of script.toolCalls ?? []) {
      const toolCallId = `tc-${nanoid(6)}`
      events?.publish({
        ...base,
        type: 'tool_execution_start',
        toolCallId,
        toolName: call.name,
        args: call.args,
      } satisfies AgentEvent)
      events?.publish({
        ...base,
        type: 'tool_execution_end',
        toolCallId,
        toolName: call.name,
        result: call.result ?? { ok: call.ok ?? true },
        isError: call.ok === false,
        latencyMs: 1,
      } satisfies AgentEvent)
    }

    events?.publish({ ...base, type: 'turn_end', tokensIn: 0, tokensOut: 0, costUsd: 0 } satisfies AgentEvent)
    events?.publish({ ...base, type: 'agent_end', reason: 'complete' } satisfies AgentEvent)

    return {
      harness: undefined as unknown as BootWakeResult['harness'],
      conversationId: base.conversationId,
      wakeId,
    }
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
      bootWake: makeStubBootWake({
        toolCalls: [{ name: 'reply', args: { text: 'ok' } }],
        onTurn: async (opts) => {
          capturedTrigger = opts.trigger as WakeTrigger
        },
      }),
      buildBootOpts: () => ({
        contactId: 'contact-x',
        events: new EventBus(),
        registrations: {
          tools: [],
          commands: [],
          observers: [],
          mutators: [],
          materializers: [],
          sideLoadContributors: [],
        },
        ports: { agents: {} as never, drive: {} as never, contacts: {} as never },
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
      bootWake: makeStubBootWake({
        onTurn: async (opts) => {
          capturedTrigger = opts.trigger as WakeTrigger
        },
      }),
      buildBootOpts: () => ({
        contactId: 'contact-x',
        events: new EventBus(),
        registrations: {
          tools: [],
          commands: [],
          observers: [],
          mutators: [],
          materializers: [],
          sideLoadContributors: [],
        },
        ports: { agents: {} as never, drive: {} as never, contacts: {} as never },
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
      bootWake: makeStubBootWake({
        onTurn: async () => {
          ran = true
        },
      }),
      buildBootOpts: () => ({
        contactId: 'contact-x',
        events: new EventBus(),
        registrations: {
          tools: [],
          commands: [],
          observers: [],
          mutators: [],
          materializers: [],
          sideLoadContributors: [],
        },
        ports: { agents: {} as never, drive: {} as never, contacts: {} as never },
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

// ─── 13–15 · Process-restart idempotency + lease + NOTIFY hook ───────────

describe('wake-worker — idempotency', () => {
  it('mid-turn crash retries the job but outbound emits exactly once', async () => {
    const { scheduler, queue } = buildRig({ debounceMs: 0 })
    await scheduler.enqueue(
      { trigger: 'manual', conversationId: CONV, reason: 'retry', actorUserId: 'u' },
      { agentId: AGENT, organizationId: ORG },
    )
    const outbound = createInMemoryOutbound()
    const emits: Array<{ toolCallId: string }> = []
    // Every retry uses a fresh EventBus so toolCallId regenerates per attempt;
    // we force a stable id across attempts by scripting a single tool call
    // and stabilising the id inside the outbound adapter.
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
      bootWake: async (opts) => {
        attempts += 1
        const bus = opts.events
        const base = {
          ts: new Date(),
          wakeId: `w-${attempts}`,
          conversationId: opts.conversationId ?? CONV,
          organizationId: opts.organizationId,
          turnIndex: 0,
        }
        bus?.publish({
          ...base,
          type: 'agent_start',
          agentId: opts.agentId,
          trigger: 'manual',
          triggerPayload: opts.trigger as WakeTrigger,
          systemHash: 'h',
        })
        if (attempts === 1) {
          // publish half-way then throw — simulates mid-turn crash BEFORE outbound emits
          throw new Error('crash')
        }
        bus?.publish({ ...base, type: 'tool_execution_start', toolCallId: stableId, toolName: 'reply', args: {} })
        bus?.publish({
          ...base,
          type: 'tool_execution_end',
          toolCallId: stableId,
          toolName: 'reply',
          result: { ok: true },
          isError: false,
          latencyMs: 1,
        })
        bus?.publish({ ...base, type: 'agent_end', reason: 'complete' })
        return {
          harness: undefined as unknown as BootWakeResult['harness'],
          conversationId: base.conversationId,
          wakeId: base.wakeId,
        }
      },
      buildBootOpts: () => ({
        contactId: 'contact-x',
        events: new EventBus(),
        registrations: {
          tools: [],
          commands: [],
          observers: [],
          mutators: [],
          materializers: [],
          sideLoadContributors: [],
        },
        ports: { agents: {} as never, drive: {} as never, contacts: {} as never },
      }),
    })
    await worker.start()
    await queue.drain()
    expect(attempts).toBeGreaterThanOrEqual(2)
    // Outbound port deduped by stable id — only 1 emit recorded in the underlying map.
    expect(outbound.log()).toHaveLength(1)
  })

  it('EventBus onWakeReleased hook fires on agent_end', () => {
    const released: Array<{ conversationId: string; wakeId: string; organizationId: string; reason: string }> = []
    const bus = new EventBus({
      onWakeReleased: (p) => {
        released.push(p)
      },
    })
    const base = { ts: new Date(), wakeId: 'w1', conversationId: CONV, organizationId: ORG, turnIndex: 0 }
    bus.publish({ ...base, type: 'agent_end', reason: 'complete' })
    expect(released).toHaveLength(1)
    expect(released[0]).toEqual({ conversationId: CONV, wakeId: 'w1', organizationId: ORG, reason: 'complete' })
  })

  it('non-agent_end events do not invoke the wake-released hook', () => {
    const released: unknown[] = []
    const bus = new EventBus({
      onWakeReleased: () => {
        released.push(1)
      },
    })
    const base = { ts: new Date(), wakeId: 'w1', conversationId: CONV, organizationId: ORG, turnIndex: 0 }
    bus.publish({ ...base, type: 'turn_start' })
    bus.publish({ ...base, type: 'turn_end', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    expect(released).toHaveLength(0)
  })
})

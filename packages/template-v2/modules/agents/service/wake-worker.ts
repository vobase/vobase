/**
 * Wake worker — pg-boss consumer that turns a queued `AgentWakeJobPayload`
 * into a real `createHarness` invocation.
 *
 * Responsibilities per job:
 *   1. Acquire the `active_wakes` lease. If another worker holds the lease,
 *      drop the job and let pg-boss retry after the debounce expires.
 *   2. Call the injected `runHarness` with the trigger payload. The harness
 *      drives the event stream through a publish-fan-out (journal + hooks).
 *   3. During the turn, every `tool_execution_end` that corresponds to a
 *      customer-facing tool is forwarded to the outbound-dispatch port. The
 *      port MUST be idempotent keyed by `(conversationId, toolCallId)` so
 *      pg-boss retries after a mid-turn crash don't emit duplicate outbound
 *      messages (acceptance: "process-restart idempotency").
 *   4. On `agent_end`, release the lease + emit a cross-process NOTIFY so
 *      any queued triggers can proceed.
 */

import type { AgentEvent, WakeTrigger } from '@modules/agents/events'
import type { ActiveWakesStore, HarnessEvent, OnEventListener } from '@vobase/core'
import { nanoid } from 'nanoid'

import { OUTBOUND_TOOL_NAME_SET } from '~/runtime/channel-events'
import { AGENT_WAKE_JOB, SCHEDULED_FOLLOWUP_JOB } from '../jobs'
import type { Job, WakeQueue } from './queue-port'
import type { AgentWakeJobPayload, ScheduledFollowupPayload } from './wake-scheduler'

export interface OutboundDispatch {
  /**
   * Emit a customer-facing event. Implementation MUST be idempotent keyed by
   * `(conversationId, toolCallId)` — a pg-boss retry after a mid-turn restart
   * will call this with the same pair and must not send twice.
   */
  emit(input: {
    conversationId: string
    toolCallId: string
    toolName: string
    wakeId: string
    organizationId: string
    result: unknown
  }): Promise<void>
}

/** In-memory idempotent outbound — used by tests. */
export function createInMemoryOutbound(): OutboundDispatch & {
  seen(): ReadonlySet<string>
  log(): ReadonlyArray<{ conversationId: string; toolCallId: string; toolName: string }>
} {
  const sent = new Set<string>()
  const log: Array<{ conversationId: string; toolCallId: string; toolName: string }> = []
  return {
    // biome-ignore lint/suspicious/useAwait: test setup may invoke async helpers
    async emit(input): Promise<void> {
      const key = `${input.conversationId}:${input.toolCallId}`
      if (sent.has(key)) return
      sent.add(key)
      log.push({ conversationId: input.conversationId, toolCallId: input.toolCallId, toolName: input.toolName })
    },
    seen(): ReadonlySet<string> {
      return sent
    },
    log() {
      return log
    },
  }
}

/**
 * Per-job harness invoker. Callers construct the template-side `createHarness`
 * options (workspace, frozen prompt, tools, listeners, etc.); the worker only
 * needs a thin handle that wraps each job's trigger + on_event listener.
 */
export interface RunHarnessInput {
  organizationId: string
  agentId: string
  conversationId: string
  trigger: WakeTrigger
  /** Extra listener the worker injects for outbound-dispatch routing. */
  extraOnEvent: OnEventListener<WakeTrigger>
}

export interface RunHarnessOutput {
  wakeId: string
}

export type RunHarnessFn = (input: RunHarnessInput) => Promise<RunHarnessOutput>

export interface WakeWorkerDeps {
  queue: WakeQueue
  activeWakes: ActiveWakesStore
  runHarness: RunHarnessFn
  outbound: OutboundDispatch
  /** Cross-process NOTIFY hook (pg NOTIFY in prod; no-op in unit tests). */
  onWakeReleased?: (payload: { conversationId: string; wakeId: string; organizationId: string }) => Promise<void>
  /** Stable worker id for lease acquisition. */
  workerId?: string
  /** Debounce window for the lease. Default 30s. */
  leaseDebounceMs?: number
}

export class WakeWorker {
  private readonly queue: WakeQueue
  private readonly activeWakes: ActiveWakesStore
  private readonly runHarness: RunHarnessFn
  private readonly outbound: OutboundDispatch
  private readonly onWakeReleased: WakeWorkerDeps['onWakeReleased']
  private readonly workerId: string
  private readonly leaseDebounceMs: number

  constructor(deps: WakeWorkerDeps) {
    this.queue = deps.queue
    this.activeWakes = deps.activeWakes
    this.runHarness = deps.runHarness
    this.outbound = deps.outbound
    this.onWakeReleased = deps.onWakeReleased
    this.workerId = deps.workerId ?? `worker-${nanoid(8)}`
    this.leaseDebounceMs = deps.leaseDebounceMs ?? 30_000
  }

  async start(): Promise<void> {
    await this.queue.work<AgentWakeJobPayload>(AGENT_WAKE_JOB, (job) => this.handle(job))
    await this.queue.work<ScheduledFollowupPayload>(SCHEDULED_FOLLOWUP_JOB, (job) => this.handle(job))
  }

  private async handle(job: Job<AgentWakeJobPayload | ScheduledFollowupPayload>): Promise<void> {
    const { trigger } = job.data
    const conversationId = trigger.conversationId
    const acquired = await this.activeWakes.acquire(conversationId, this.workerId, this.leaseDebounceMs)
    if (!acquired) return

    let wakeId = ''
    try {
      const organizationId = job.data.organizationId
      const outboundListener = this.makeOutboundListener(conversationId, organizationId)
      const result = await this.runHarness({
        organizationId,
        agentId: job.data.agentId,
        conversationId,
        trigger: trigger as WakeTrigger,
        extraOnEvent: outboundListener,
      })
      wakeId = result.wakeId
    } finally {
      await this.activeWakes.release(conversationId, this.workerId)
      if (wakeId) {
        await this.onWakeReleased?.({ conversationId, wakeId, organizationId: job.data.organizationId })
      }
    }
  }

  /**
   * Listener that forwards every `tool_execution_end` targeting an
   * outbound-facing tool through the idempotent outbound port.
   */
  private makeOutboundListener(conversationId: string, organizationId: string): OnEventListener<WakeTrigger> {
    return (ev: HarnessEvent<WakeTrigger>): void => {
      const event = ev as unknown as AgentEvent
      if (event.type !== 'tool_execution_end') return
      if (event.toolName === 'staff_reply') return
      if (!OUTBOUND_TOOL_NAME_SET.has(event.toolName)) return
      void this.outbound.emit({
        conversationId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        wakeId: event.wakeId,
        organizationId,
        result: event.result,
      })
    }
  }
}

export function createWakeWorker(deps: WakeWorkerDeps): WakeWorker {
  return new WakeWorker(deps)
}

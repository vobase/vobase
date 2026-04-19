/**
 * Wake worker — pg-boss consumer that turns a queued `AgentWakeJobPayload`
 * into a real bootWake invocation.
 *
 * Responsibilities per job:
 *   1. Acquire the `active_wakes` lease. If another worker holds the lease,
 *      drop the job and let pg-boss retry after the debounce expires.
 *   2. Call `bootWake` with the trigger payload. The harness drives the event
 *      stream through `EventBus` → observers + journal.
 *   3. During the turn, every `tool_execution_end` that corresponds to a
 *      customer-facing tool is forwarded to the outbound-dispatch port. The
 *      port MUST be idempotent keyed by `(conversationId, toolCallId)` so
 *      pg-boss retries after a mid-turn crash don't emit duplicate outbound
 *      messages (acceptance: "process-restart idempotency").
 *   4. On `agent_end`, release the lease + emit a cross-process NOTIFY so
 *      any queued triggers can proceed.
 */

import { OUTBOUND_TOOL_NAME_SET } from '@server/contracts/channel-event'
import type { AgentEvent, WakeTrigger } from '@server/contracts/event'
import type { BootWakeOpts, BootWakeResult } from '@server/harness/agent-runner'
import { nanoid } from 'nanoid'
import type { ActiveWakesStore } from './active-wakes'
import { AGENT_WAKE_JOB, SCHEDULED_FOLLOWUP_JOB } from './queue-jobs'
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
    tenantId: string
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

export type BootWakeInvoker = (opts: BootWakeOpts) => Promise<BootWakeResult>

export interface WakeWorkerDeps {
  queue: WakeQueue
  activeWakes: ActiveWakesStore
  bootWake: BootWakeInvoker
  outbound: OutboundDispatch
  /** Cross-process NOTIFY hook (pg NOTIFY in prod; no-op in unit tests). */
  onWakeReleased?: (payload: { conversationId: string; wakeId: string; tenantId: string }) => Promise<void>
  /** Invariant deps needed by bootWake but not carried in the job payload. */
  buildBootOpts(
    payload: AgentWakeJobPayload | ScheduledFollowupPayload,
  ): Omit<BootWakeOpts, 'trigger' | 'tenantId' | 'agentId' | 'conversationId'> & { contactId: string }
  /** Stable worker id for lease acquisition. */
  workerId?: string
  /** Debounce window for the lease. Default 30s. */
  leaseDebounceMs?: number
}

export class WakeWorker {
  private readonly queue: WakeQueue
  private readonly activeWakes: ActiveWakesStore
  private readonly bootWake: BootWakeInvoker
  private readonly outbound: OutboundDispatch
  private readonly onWakeReleased: WakeWorkerDeps['onWakeReleased']
  private readonly buildBootOpts: WakeWorkerDeps['buildBootOpts']
  private readonly workerId: string
  private readonly leaseDebounceMs: number

  constructor(deps: WakeWorkerDeps) {
    this.queue = deps.queue
    this.activeWakes = deps.activeWakes
    this.bootWake = deps.bootWake
    this.outbound = deps.outbound
    this.onWakeReleased = deps.onWakeReleased
    this.buildBootOpts = deps.buildBootOpts
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
      const overrides = this.buildBootOpts(job.data)
      const bootOpts: BootWakeOpts = {
        tenantId: job.data.tenantId,
        agentId: job.data.agentId,
        conversationId,
        trigger: trigger as WakeTrigger,
        ...overrides,
      }
      const outboundSubscription = this.subscribeOutbound(bootOpts, conversationId, job.data.tenantId)
      try {
        const result = await this.bootWake(bootOpts)
        wakeId = result.wakeId
      } finally {
        outboundSubscription()
      }
    } finally {
      await this.activeWakes.release(conversationId, this.workerId)
      if (wakeId) {
        await this.onWakeReleased?.({ conversationId, wakeId, tenantId: job.data.tenantId })
      }
    }
  }

  /**
   * Decorate `bootOpts.events` so every `tool_execution_end` that targets an
   * outbound-facing tool is forwarded through the idempotent outbound port.
   * Returns a disposer that removes the decoration.
   */
  private subscribeOutbound(bootOpts: BootWakeOpts, conversationId: string, tenantId: string): () => void {
    const existing = bootOpts.events
    if (!existing) {
      // bootWake will construct its own EventBus when `events` is omitted —
      // we can't intercept that one. Wrap only when the caller passed a bus.
      return () => undefined
    }
    const handler = (event: AgentEvent): void => {
      if (event.type !== 'tool_execution_end') return
      if (event.toolName === 'staff_reply') return
      if (!OUTBOUND_TOOL_NAME_SET.has(event.toolName)) return
      void this.outbound.emit({
        conversationId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        wakeId: event.wakeId,
        tenantId,
        result: event.result,
      })
    }
    return existing.subscribe(handler)
  }
}

export function createWakeWorker(deps: WakeWorkerDeps): WakeWorker {
  return new WakeWorker(deps)
}

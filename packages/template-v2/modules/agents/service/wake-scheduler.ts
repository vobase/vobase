/**
 * Wake scheduler — translates the five canonical triggers into queued wake
 * jobs. Two responsibilities:
 *
 *   1. **Pre-wake debounce** — inbound_message triggers collapse onto a single
 *      job per (agent, conversation) via `singletonKey` + a 1s `startAfter`
 *      window. Rapid bursts merge their `messageIds` into the pending job's
 *      payload.
 *   2. **In-wake steer** — if a lease already exists in `agents.active_wakes`
 *      the inbound is forwarded via `pg_notify('wake:<worker>')` so the
 *      running worker can inject the message at the next tool boundary.
 *
 * The scheduler does not run any agents itself; consumption lives in
 * `wake-worker.ts`.
 */

import type { WakeTrigger } from '@modules/agents/events'
import { type ActiveWakesStore, createInMemoryActiveWakes } from '@vobase/core'

import { AGENT_WAKE_JOB, SCHEDULED_FOLLOWUP_JOB } from './queue-jobs'
import type { SendOpts, WakeQueue } from './queue-port'

export type { WakeTrigger }

export interface InProcessNotifier {
  notify(channel: string, payload: Record<string, unknown>): Promise<void>
}

export interface WakeSchedulerDeps {
  queue: WakeQueue
  activeWakes: ActiveWakesStore
  notifier?: InProcessNotifier
  /**
   * Debounce window for burst-collapse. Production default 1000ms;
   * tests override to 0 to exercise immediate dispatch.
   */
  debounceMs?: number
}

export interface AgentWakeJobPayload {
  trigger: WakeTrigger
  agentId: string
  organizationId: string
  /** Set when the enqueue traced the conversation back to an agent. */
  scheduledAt?: string
}

export interface ScheduledFollowupPayload {
  trigger: Extract<WakeTrigger, { trigger: 'scheduled_followup' }>
  agentId: string
  organizationId: string
  scheduledAt: string
}

export interface EnqueueOpts {
  agentId: string
  organizationId: string
}

export interface EnqueueResult {
  jobId: string | null
  wasNew: boolean
  steered: boolean
}

function singletonKey(agentId: string, conversationId: string): string {
  return `agents:agent-wake:${agentId}:${conversationId}`
}

function mergeInbound(existing: AgentWakeJobPayload, incoming: AgentWakeJobPayload): AgentWakeJobPayload {
  if (existing.trigger.trigger !== 'inbound_message' || incoming.trigger.trigger !== 'inbound_message') {
    return incoming
  }
  const merged = new Set<string>(existing.trigger.messageIds)
  for (const id of incoming.trigger.messageIds) merged.add(id)
  return {
    ...existing,
    trigger: { ...existing.trigger, messageIds: Array.from(merged) },
  }
}

export class WakeScheduler {
  private readonly queue: WakeQueue
  private readonly activeWakes: ActiveWakesStore
  private readonly notifier: InProcessNotifier | undefined
  private readonly debounceMs: number

  constructor(deps: WakeSchedulerDeps) {
    this.queue = deps.queue
    this.activeWakes = deps.activeWakes
    this.notifier = deps.notifier
    this.debounceMs = deps.debounceMs ?? 1000
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async enqueue(trigger: WakeTrigger, opts: EnqueueOpts): Promise<EnqueueResult> {
    switch (trigger.trigger) {
      case 'inbound_message':
        return this.enqueueInbound(trigger, opts)
      case 'approval_resumed':
      case 'supervisor':
      case 'manual':
        return this.enqueueAgentWake(trigger, opts, { startAfter: 0 })
      case 'scheduled_followup':
        return this.enqueueScheduled(trigger, opts)
      default: {
        const exhaustive: never = trigger
        throw new Error(`wake-scheduler: unknown trigger ${String(exhaustive)}`)
      }
    }
  }

  private async enqueueInbound(
    trigger: Extract<WakeTrigger, { trigger: 'inbound_message' }>,
    opts: EnqueueOpts,
  ): Promise<EnqueueResult> {
    const holder = await this.activeWakes.getWorker(trigger.conversationId)
    if (holder) {
      // Live wake — steer via NOTIFY so the worker injects at next tool boundary.
      await this.notifier?.notify(`wake:${holder}`, {
        op: 'steer',
        conversationId: trigger.conversationId,
        messageIds: trigger.messageIds,
      })
      return { jobId: null, wasNew: false, steered: true }
    }
    const payload: AgentWakeJobPayload = {
      trigger,
      agentId: opts.agentId,
      organizationId: opts.organizationId,
    }
    const result = await this.queue.sendOrMerge<AgentWakeJobPayload>(
      AGENT_WAKE_JOB,
      payload,
      {
        singletonKey: singletonKey(opts.agentId, trigger.conversationId),
        startAfter: this.debounceMs / 1000,
      },
      mergeInbound,
    )
    return { jobId: result.jobId, wasNew: result.wasNew, steered: false }
  }

  private async enqueueAgentWake(trigger: WakeTrigger, opts: EnqueueOpts, sendOpts: SendOpts): Promise<EnqueueResult> {
    const payload: AgentWakeJobPayload = { trigger, agentId: opts.agentId, organizationId: opts.organizationId }
    const result = await this.queue.send<AgentWakeJobPayload>(AGENT_WAKE_JOB, payload, sendOpts)
    return { jobId: result.jobId, wasNew: result.wasNew, steered: false }
  }

  private async enqueueScheduled(
    trigger: Extract<WakeTrigger, { trigger: 'scheduled_followup' }>,
    opts: EnqueueOpts,
  ): Promise<EnqueueResult> {
    const payload: ScheduledFollowupPayload = {
      trigger,
      agentId: opts.agentId,
      organizationId: opts.organizationId,
      scheduledAt: trigger.scheduledAt.toISOString(),
    }
    const result = await this.queue.send<ScheduledFollowupPayload>(SCHEDULED_FOLLOWUP_JOB, payload, {
      startAfter: trigger.scheduledAt,
    })
    return { jobId: result.jobId, wasNew: result.wasNew, steered: false }
  }
}

export function createWakeScheduler(deps: WakeSchedulerDeps): WakeScheduler {
  return new WakeScheduler(deps)
}

export function createInProcessScheduler(opts: {
  queue: WakeQueue
  notifier?: InProcessNotifier
  debounceMs?: number
}): { scheduler: WakeScheduler; activeWakes: ActiveWakesStore } {
  const activeWakes = createInMemoryActiveWakes()
  const scheduler = new WakeScheduler({ ...opts, activeWakes })
  return { scheduler, activeWakes }
}

/**
 * In-process `EventBus`. Synchronous fanout to subscribers; subscriber throws
 * are isolated (logged, not propagated).
 *
 * pg NOTIFY fanout for cross-process SSE is wired separately in core's realtime
 * service — modules that want cross-process visibility call `ctx.realtime.notify()`
 * from their observer/mutator.
 */
import type { AgentEvent } from '@server/contracts/event'
import type { EventBus as EventBusContract } from '@server/contracts/plugin-context'

type Subscriber = (event: AgentEvent) => void | Promise<void>

/**
 * Cross-process NOTIFY hook. When an `agent_end` passes through the bus, the
 * hook is invoked with `{channel: 'wake_released', payload: {...}}` so the
 * runtime can emit a pg NOTIFY for queued triggers waiting on the lease to
 * drop. The bus itself stays in-process; cross-process
 * fanout is the hook's responsibility.
 */
export type WakeReleasedHook = (payload: {
  conversationId: string
  wakeId: string
  tenantId: string
  reason: string
}) => void | Promise<void>

export class EventBus implements EventBusContract {
  private readonly subscribers = new Set<Subscriber>()
  private readonly onError: (err: unknown, event: AgentEvent) => void
  private readonly onWakeReleased: WakeReleasedHook | undefined

  constructor(opts?: {
    onError?: (err: unknown, event: AgentEvent) => void
    onWakeReleased?: WakeReleasedHook
  }) {
    this.onError = opts?.onError ?? (() => undefined)
    this.onWakeReleased = opts?.onWakeReleased
  }

  publish(event: AgentEvent): void {
    for (const sub of this.subscribers) {
      try {
        const result = sub(event)
        if (result && typeof (result as Promise<void>).then === 'function') {
          ;(result as Promise<void>).catch((err) => this.onError(err, event))
        }
      } catch (err) {
        this.onError(err, event)
      }
    }
    if (event.type === 'agent_end' && this.onWakeReleased) {
      try {
        const result = this.onWakeReleased({
          conversationId: event.conversationId,
          wakeId: event.wakeId,
          tenantId: event.tenantId,
          reason: event.reason,
        })
        if (result && typeof (result as Promise<void>).then === 'function') {
          ;(result as Promise<void>).catch((err) => this.onError(err, event))
        }
      } catch (err) {
        this.onError(err, event)
      }
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  size(): number {
    return this.subscribers.size
  }
}

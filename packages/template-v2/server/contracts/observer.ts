/**
 * AgentObserver — read-only event subscriber.
 *
 * Observers run on per-observer queues; a slow observer CANNOT backpressure other
 * observers (see `server/runtime/observer-bus.ts`). Throws are swallowed + logged.
 *
 * Wake identity (`organizationId`, `conversationId`, `wakeId`, `turnIndex`) is
 * read from the event itself (`HarnessBaseFields`). Services (`db`, `realtime`,
 * `logger`) are singletons in `server/services.ts`.
 *
 * `ObserverContext` survives only as the parent type of `MutatorContext` (mutator
 * still runs inside tool-call boundaries where per-wake fields matter); observers
 * no longer consume it.
 */

import type { AgentEvent } from './event'
import type { PluginContext } from './plugin-context'

export interface Logger {
  debug(obj: unknown, msg?: string): void
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
}

export interface ObserverContext {
  readonly organizationId: string
  readonly conversationId: string
  readonly wakeId: string
  readonly db: PluginContext['db']
  readonly logger: Logger
  readonly realtime: PluginContext['realtime']
}

export interface AgentObserver {
  /** Stable across restarts — used for queue identity. */
  id: string
  handle(event: AgentEvent): Promise<void> | void
}

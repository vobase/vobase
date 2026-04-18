/**
 * AgentObserver — read-only event subscriber. Spec §6.6 + §12.1.
 *
 * Observers run on per-observer queues; a slow observer CANNOT backpressure other
 * observers (see `server/runtime/observer-bus.ts`). Throws are swallowed + logged.
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
  readonly tenantId: string
  readonly conversationId: string
  readonly wakeId: string
  readonly ports: PluginContext['ports']
  readonly db: PluginContext['db']
  readonly logger: Logger
  readonly realtime: PluginContext['realtime']
}

export interface AgentObserver {
  /** Stable across restarts — used for queue identity. */
  id: string
  handle(event: AgentEvent, ctx: ObserverContext): Promise<void> | void
}

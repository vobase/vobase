/**
 * WakeContext — the per-wake scope surfaced to observer factories.
 *
 * At register time (module `init(ctx)`) the `PluginContext.llmCall` /
 * `events.publish` fields are boot-time throw-proxies because no wake exists
 * yet. Observers that need these primitives register a FACTORY with
 * `ctx.registerObserverFactory((wake) => createXObserver({ ... }))`; the
 * harness invokes the factory once per wake with the real, per-wake
 * bindings.
 */
import type { Logger } from './observer'
import type { PluginContext } from './plugin-context'

export interface WakeContext {
  readonly organizationId: string
  readonly wakeId: string
  readonly conversationId: string
  readonly agentId: string
  readonly logger: Logger
  readonly llmCall: PluginContext['llmCall']
}

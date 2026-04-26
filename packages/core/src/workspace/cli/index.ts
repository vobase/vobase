// Just-bash dispatcher (legacy, used inside the wake for bash-string verbs).

// Transport-agnostic verb surface (used by HTTP-RPC, in-process, future MCP).
export { type CatalogRouteOpts, createCatalogRoute } from './catalog-route'
export type { CliVerbBodyArgs, CliVerbDef, CliVerbResult, DefineCliVerbOpts } from './define'
export { defaultRouteForVerb, defineCliVerb } from './define'
export { type CliDispatchRouteOpts, createCliDispatchRoute } from './dispatch-route'
export {
  type AgentRole,
  createVobaseCommand,
  DEFAULT_READ_ONLY_VERBS,
  findCommand,
  resolveCommandSet,
  VobaseCliCollisionError,
  type VobaseDispatcherOpts,
} from './dispatcher'
export { createInProcessTransport, type InProcessTransportOpts } from './in-process-transport'
export { type Catalog, type CatalogVerb, CliVerbRegistry } from './registry'
export type { VerbContext, VerbEvent, VerbFormat, VerbResult, VerbTransport } from './transport'

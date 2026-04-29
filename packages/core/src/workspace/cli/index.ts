// Just-bash dispatcher (registry-driven; one verb definition serves both bash and HTTP).
export {
  type CreateBashVobaseCommandOpts,
  coerceBashArgs,
  createBashVobaseCommand,
  parseBashArgv,
} from './bash-vobase-command'
// Transport-agnostic verb surface.
export { type CatalogRouteOpts, createCatalogRoute } from './catalog-route'
export type { CliVerbBodyArgs, CliVerbDef, CliVerbResult, DefineCliVerbOpts } from './define'
export { defaultRouteForVerb, defineCliVerb } from './define'
export { type CliDispatchRouteOpts, createCliDispatchRoute } from './dispatch-route'
export {
  type BashRenderArgs,
  type BashRenderResult,
  createInProcessTransport,
  type InProcessTransportOpts,
  renderBashHelp,
  renderBashResult,
} from './in-process-transport'
export { type Catalog, type CatalogVerb, CliVerbRegistry, VobaseCliCollisionError } from './registry'
export type { VerbContext, VerbEvent, VerbFormat, VerbResult, VerbTransport } from './transport'

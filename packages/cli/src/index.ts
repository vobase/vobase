/**
 * `@vobase/cli` — public surface.
 *
 * The CLI binary entry lives at `bin/vobase.ts`; this module re-exports the
 * primitives that compose it (config loader, HTTP-RPC transport, catalog
 * client, output formatter, command resolver, help generator) so they can
 * be unit-tested and reused.
 */

export type { Catalog, CatalogVerb } from './catalog'
export { CatalogClient } from './catalog'
export { type Config, ConfigSchema, configPath, loadConfig, resolveConfigName, writeConfig } from './config'
export { renderGlobalHelp, renderGroupHelp } from './help'
export { type Format, formatRelative, formatResult } from './output'
export { matchVerb, parseArgs, type ResolveOpts, type ResolveResult, resolve } from './resolver'
export { type HttpRpcResult, httpRpc } from './transport/http'

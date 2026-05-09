/**
 * `GET /api/cli/verbs` catalog endpoint.
 *
 * Serializes the runtime's `CliVerbRegistry` into the JSON shape the CLI
 * binary expects:
 *
 *   { verbs: [...], etag: '<sha256>' }
 *
 * Etag negotiation:
 *
 *   - No `If-None-Match` header  → 200 + body
 *   - `If-None-Match` matches    → 304 (cache still valid)
 *   - `If-None-Match` mismatches → 412 + new body (CLI swaps cache inline,
 *                                  no follow-up GET needed)
 *
 * The 412+body response is intentional and documented in the vobase-cli
 * spec — it eliminates the second round-trip on etag drift.
 */

import type { Context, Env } from 'hono'
import { Hono } from 'hono'

import type { AudienceTier, CliVerbRegistry } from './registry'

export interface CatalogRouteOpts<TEnv extends Env = Env> {
  registry: CliVerbRegistry
  /** Derive the caller's audience tier from the request context. Defaults to `'admin'`. */
  getAudience?: (c: Context<TEnv>) => AudienceTier
  /** Latest published CLI version, surfaced to clients so older CLIs can warn-once. */
  clientLatestVersion?: string
}

export function createCatalogRoute<TEnv extends Env = Env>(opts: CatalogRouteOpts<TEnv>): Hono<TEnv> {
  const app = new Hono<TEnv>()
  app.get('/verbs', (c) => {
    const tier: AudienceTier = opts.getAudience?.(c) ?? 'admin'
    const catalog = opts.registry.catalogFor(tier)
    const body: Record<string, unknown> = { verbs: catalog.verbs, etag: catalog.etag }
    if (opts.clientLatestVersion !== undefined) body.clientLatestVersion = opts.clientLatestVersion
    const ifNoneMatch = c.req.header('If-None-Match')
    if (ifNoneMatch === catalog.etag) {
      return new Response(null, { status: 304, headers: { ETag: catalog.etag } })
    }
    const status = ifNoneMatch ? 412 : 200
    return c.json(body, status, { ETag: catalog.etag })
  })
  return app
}

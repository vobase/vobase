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

import { Hono } from 'hono'

import type { CliVerbRegistry } from './registry'

export interface CatalogRouteOpts {
  registry: CliVerbRegistry
}

export function createCatalogRoute(opts: CatalogRouteOpts): Hono {
  const app = new Hono()
  app.get('/verbs', (c) => {
    const catalog = opts.registry.catalog()
    const ifNoneMatch = c.req.header('If-None-Match')
    if (ifNoneMatch) {
      if (ifNoneMatch === catalog.etag) {
        return new Response(null, { status: 304, headers: { ETag: catalog.etag } })
      }
      return c.json(catalog, 412, { ETag: catalog.etag })
    }
    return c.json(catalog, 200, { ETag: catalog.etag })
  })
  return app
}

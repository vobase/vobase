/**
 * HTTP verb-dispatch route. Pairs with the catalog endpoint to give the
 * standalone `@vobase/cli` binary a single seam: GET /api/cli/verbs to
 * discover what's there, POST /api/cli/<verb-route> to invoke a verb.
 *
 * Verb routes are catalog-driven — the binary never invents URLs. The
 * dispatcher looks up the verb by its registered `route` field, validates
 * the JSON body via the registry's dispatch, and returns a typed result.
 *
 * The route is generic over the transport context: callers supply a
 * `resolveContext(c)` callback that pulls a `VerbContext` from the Hono
 * context (typically built from API-key middleware results). The handler
 * builds a one-shot `VerbTransport` per request and hands it to
 * `registry.dispatch`.
 */

import type { Context, Hono as HonoCtor } from 'hono'
import { Hono } from 'hono'

import type { CliVerbRegistry } from './registry'
import type { VerbContext, VerbEvent, VerbTransport } from './transport'

export interface CliDispatchRouteOpts {
  registry: CliVerbRegistry
  /**
   * Build the verb context for an incoming request. Typical implementation
   * reads `c.get('apiPrincipal')` from the API-key middleware and produces
   * `{ organizationId, principal, role }`.
   */
  resolveContext: (c: Context) => Promise<VerbContext> | VerbContext
  /** Optional audit / metrics hook called once per dispatched verb. */
  recordEvent?(event: VerbEvent): void
}

/**
 * Build a Hono router that dispatches every catalog-registered verb. Mount
 * at the same prefix as the catalog (`/api/cli`) — the catalog occupies
 * `/verbs` and verbs occupy `/<group>/<name>` so they coexist.
 */
export function createCliDispatchRoute(opts: CliDispatchRouteOpts): HonoCtor {
  const app = new Hono()
  app.post('/*', async (c) => {
    const requestPath = `/${c.req.path.replace(/^\/+/u, '')}`
    const verb = findVerbByRoute(opts.registry, requestPath)
    if (!verb) {
      return c.json({ ok: false, errorCode: 'unknown_verb', error: `No verb registered at ${requestPath}` }, 404)
    }
    const input = (await c.req.json().catch(() => ({}))) as unknown
    const transport: VerbTransport = {
      name: 'http',
      resolveContext: () => opts.resolveContext(c),
      formatResult: (result) => result as object,
      recordEvent: opts.recordEvent,
    }
    const result = await opts.registry.dispatch(verb.name, input, transport)
    if (result.ok) return c.json({ ok: true, data: result.data })
    const status = errorCodeToStatus(result.errorCode)
    return c.json({ ok: false, errorCode: result.errorCode, error: result.error }, status)
  })
  return app
}

function findVerbByRoute(registry: CliVerbRegistry, route: string) {
  return registry.list().find((v) => v.route === route)
}

/** Map verb-result error codes to HTTP statuses for the binary's error UI. */
function errorCodeToStatus(code: string | undefined): 400 | 403 | 404 | 500 {
  if (code === 'unknown_verb') return 404
  if (code === 'forbidden') return 403
  if (code === 'invalid_input') return 400
  return 500
}

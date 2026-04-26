/**
 * HTTP verb-dispatch route. Pairs with the catalog endpoint: GET /api/cli/verbs
 * discovers verbs, POST /api/cli/<verb-route> invokes one. Generic over the
 * Hono env so callers can preserve the typed `apiPrincipal` from middleware.
 */

import type { Context, Env, Hono as HonoCtor } from 'hono'
import { Hono } from 'hono'

import type { CliVerbRegistry } from './registry'
import type { VerbContext, VerbEvent, VerbTransport } from './transport'

export interface CliDispatchRouteOpts<E extends Env = Env> {
  registry: CliVerbRegistry
  /** Build the per-request VerbContext from the typed Hono context. */
  resolveContext: (c: Context<E>) => Promise<VerbContext> | VerbContext
  /** Optional audit / metrics hook called once per dispatched verb. */
  recordEvent?(event: VerbEvent): void
}

export function createCliDispatchRoute<E extends Env = Env>(opts: CliDispatchRouteOpts<E>): HonoCtor<E> {
  const app = new Hono<E>()
  app.post('/*', async (c) => {
    const requestPath = `/${c.req.path.replace(/^\/+/u, '')}`
    const verb = opts.registry.getByRoute(requestPath)
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

function errorCodeToStatus(code: string | undefined): 400 | 403 | 404 | 500 {
  if (code === 'unknown_verb') return 404
  if (code === 'forbidden') return 403
  if (code === 'invalid_input') return 400
  return 500
}

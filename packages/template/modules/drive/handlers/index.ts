import type { Auth } from '@auth'
import { type DriveScopeKind, type OrganizationEnv, requireOrganization, scopeRbac } from '@auth/middleware'
import { type Context, Hono, type MiddlewareHandler } from 'hono'

import { getDriveAuth } from '../service/files'
import filesHandlers from './files'

/**
 * Per-request scope-RBAC gate. Reads the better-auth handle threaded into the
 * drive module via `ctx.auth` at boot time and stashed under module state.
 *
 * Falls through with no gate when auth is not installed (unit-test mode).
 */
function scopeGate(write: boolean): MiddlewareHandler {
  return async (c: Context<OrganizationEnv>, next) => {
    const auth = getDriveAuth() as Auth | null
    if (!auth) return next()
    // Chain requireOrganization → scopeRbac → next. `c.json(...)` creates a
    // Response but does not set `c.res`; only the outermost `return` actually
    // wires the Response into Hono. So we have to capture a blocking Response
    // from either layer and surface it as our own return value.
    let blocked: Response | undefined
    const orgResponse = await requireOrganization(c, (async () => {
      const rbacResponse = await scopeRbac(auth, { write })(c, next)
      if (rbacResponse) blocked = rbacResponse
    }) as never)
    return orgResponse ?? blocked
  }
}

/**
 * Body-aware variant of `scopeGate` for non-GET routes whose scope discriminator
 * lives in the JSON body (`PUT /file`, `POST /folders`). Pre-parses the body
 * once; downstream `zValidator` calls hit Hono's internal cache rather than
 * re-reading the underlying stream.
 */
function bodyScopeGate(write: boolean): MiddlewareHandler {
  return async (c: Context<OrganizationEnv>, next) => {
    const auth = getDriveAuth() as Auth | null
    if (!auth) return next()
    let body: Record<string, unknown> = {}
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      body = {}
    }

    const readScope = (): DriveScopeKind | undefined => {
      const s = body.scope
      return typeof s === 'string' ? (s as DriveScopeKind) : undefined
    }
    const readStaffUserId = (): string | undefined => {
      const u = body.userId
      return typeof u === 'string' ? u : undefined
    }

    let blocked: Response | undefined
    const orgResponse = await requireOrganization(c, (async () => {
      const rbacResponse = await scopeRbac(auth, { write, readScope, readStaffUserId })(c, next)
      if (rbacResponse) blocked = rbacResponse
    }) as never)
    return orgResponse ?? blocked
  }
}

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'drive', status: 'ok' }))
  .use('/tree', scopeGate(false))
  .use('/file', (c, next) => {
    if (c.req.method === 'GET') return scopeGate(false)(c, next)
    return bodyScopeGate(true)(c, next)
  })
  .use('/folders', bodyScopeGate(true))
  // `/moves` and `/file/:id` carry the scope inside the row, not in URL/body —
  // the handlers in `files.ts` run their own row-derived `rowScopeCheck`. We
  // still ensure `requireOrganization` populates `c.get('organizationId')`.
  .use('/moves', requireOrganization)
  .use('/file/:id', requireOrganization)
  .route('/', filesHandlers)

export default app

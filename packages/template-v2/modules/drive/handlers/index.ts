import type { Auth } from '@server/auth'
import { type OrganizationEnv, requireOrganization, scopeRbac } from '@server/middlewares'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { getDriveAuth } from '../service/files'
import filesHandlers from './files'
import proposalHandlers from './proposal'

/**
 * Per-request scope-RBAC gate. Loaded lazily because better-auth is constructed
 * after the drive module's `init()` runs — the Auth instance is published via
 * `installDriveAuth()` in `wireAuthIntoModules()`.
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

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'drive', status: 'ok' }))
  .route('/proposals', proposalHandlers)
  .use('/tree', scopeGate(false))
  .use('/file', async (c, next) => scopeGate(c.req.method !== 'GET')(c, next))
  .use('/folders', scopeGate(true))
  .use('/moves', scopeGate(true))
  .use('/file/:id', scopeGate(true))
  .route('/', filesHandlers)

export default app

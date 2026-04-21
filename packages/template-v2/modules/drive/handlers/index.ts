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
    // Chain requireOrganization → scopeRbac → next. Each middleware in the
    // chain either blocks (finalizing c with c.json) or falls through to its
    // own `next`. Returning undefined is fine — Hono checks c.finalized.
    return requireOrganization(c, () => scopeRbac(auth, { write })(c, next) as Promise<void>)
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

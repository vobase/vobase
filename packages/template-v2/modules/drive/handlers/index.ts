import type { Auth } from '@server/auth'
import { requireOrganization, scopeRbac } from '@server/middlewares'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { getDriveAuth } from '../service/files'
import filesHandlers from './files'
import proposalHandlers from './proposal'

/**
 * Per-request scope-RBAC gate. Loaded lazily because better-auth is constructed
 * after the drive module's `init()` runs — the Auth instance is published via
 * `installDriveAuth()` in `wireAuthIntoModules()`.
 *
 * Falls through with no gate when auth is not installed — unit tests mount
 * `filesHandlers` directly without a session layer.
 */
function scopeGate(write: boolean): MiddlewareHandler {
  return async (c: Context, next) => {
    const auth = getDriveAuth() as Auth | null
    if (!auth) return next()
    let resp: Response | undefined
    await requireOrganization(c, async () => {
      resp = (await scopeRbac(auth, { write })(c, next)) ?? undefined
    })
    return resp
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

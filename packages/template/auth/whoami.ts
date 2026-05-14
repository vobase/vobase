/**
 * `GET /api/auth/whoami` — returns the principal/org/role for the caller. The
 * CLI's `vobase auth whoami` command calls this to verify a freshly-saved API
 * key works against the configured tenant.
 *
 * Authentication runs through the standard session chain: the `apiKey` plugin
 * mocks a session from a valid `Authorization: Bearer vbt_<key>` header, so
 * `requireSession` + `requireOrganization` + `requireRole` resolve it exactly
 * as they would a cookie session.
 */

import type { Auth } from '@auth'
import { Hono } from 'hono'

import type { ScopedDb } from '~/runtime'
import { createRequireRole, type RoleEnv, requireOrganization } from './middleware'
import { createRequireSession } from './middleware/require-session'

export function createWhoamiRoute(auth: Auth, db: ScopedDb): Hono<RoleEnv> {
  const app = new Hono<RoleEnv>()
  const requireSession = createRequireSession(auth)
  // Middleware is scoped to /whoami specifically — `app.use('*')` would
  // intercept every /api/auth/* request (including dev-login + the better-auth
  // catch-all) and return 401 before they could route.
  app.use('/whoami', requireSession, requireOrganization, createRequireRole(db, ['owner', 'admin', 'member']))
  app.get('/whoami', (c) => {
    const session = c.get('session')
    return c.json({
      principal: { kind: 'apikey' as const, id: session.user.id, email: session.user.email },
      organizationId: c.get('organizationId'),
      role: c.get('memberRole'),
    })
  })
  return app
}

/**
 * `GET /api/auth/whoami` — returns the principal/org/role derived from a
 * verified API key. The CLI's `vobase auth whoami` command calls this to
 * verify a freshly-saved key works against the configured tenant.
 */

import { Hono } from 'hono'

import type { ScopedDb } from '~/runtime'
import { type ApiKeyEnv, createRequireApiKey } from './middleware/require-api-key'

export function createWhoamiRoute(db: ScopedDb): Hono<ApiKeyEnv> {
  // Middleware is scoped to /whoami specifically — `app.use('*')` would
  // intercept every /api/auth/* request (including dev-login + better-auth
  // catch-all) and return 401 before they could route.
  const app = new Hono<ApiKeyEnv>()
  app.use('/whoami', createRequireApiKey(db))
  app.get('/whoami', (c) => {
    const p = c.get('apiPrincipal')
    return c.json({
      principal: { kind: 'apikey' as const, id: p.userId, email: p.email },
      organizationId: p.organizationId,
      role: p.role,
    })
  })
  return app
}

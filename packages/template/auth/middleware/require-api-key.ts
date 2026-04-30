/**
 * `Authorization: Bearer vbt_<token>` middleware. Verifies the key against the
 * `auth_apikey` table, resolves the owning user's active membership, and
 * stashes a typed `apiPrincipal` into the Hono context for downstream
 * handlers (whoami, catalog, all CLI verb routes).
 */

import type { Context, MiddlewareHandler } from 'hono'

import type { ScopedDb } from '~/runtime'
import { type ApiKeyPrincipal, resolveApiKeyPrincipal, verifyApiKey } from '../api-keys'

export interface ApiKeyEnv {
  Variables: { apiPrincipal: ApiKeyPrincipal }
}

const BEARER_RE = /^Bearer\s+(vbt_[A-Za-z0-9_-]+)$/u

function parseBearer(header: string): string | null {
  const match = header.match(BEARER_RE)
  return match ? match[1] : null
}

export function createRequireApiKey(db: ScopedDb): MiddlewareHandler {
  return async (c: Context<ApiKeyEnv>, next): Promise<Response | undefined> => {
    const token = parseBearer(c.req.header('Authorization') ?? '')
    if (!token) return c.json({ error: 'unauthorized' }, 401)
    const verify = await verifyApiKey({ db, token })
    if (!verify.ok || !verify.userId) return c.json({ error: 'unauthorized' }, 401)
    const principal = await resolveApiKeyPrincipal(db, verify.userId)
    if (!principal) return c.json({ error: 'unauthorized' }, 401)
    c.set('apiPrincipal', principal)
    await next()
    return undefined
  }
}

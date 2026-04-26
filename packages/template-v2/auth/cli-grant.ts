/**
 * CLI device-grant flow.
 *
 * Three endpoints + one in-memory store:
 *
 *   POST /api/auth/cli-grant           — CLI starts a grant; gets `{ code, url, ttlMs }`
 *   POST /api/auth/cli-grant/confirm   — browser-side, session-authenticated;
 *                                         mints API key, attaches it to grant
 *   GET  /api/auth/cli-grant/poll      — CLI polls for completion
 *
 * The grant store is intentionally in-memory: codes are short-lived (5 min),
 * single-use, and the only state that needs to survive between the CLI's
 * `start` and `poll` is the issued API key. Persisting to Postgres would add
 * a table for state with a half-hour lifetime.
 */

import type { Auth } from '@auth'
import { Hono } from 'hono'

import type { ScopedDb } from '~/runtime'
import { createApiKey } from './api-keys'
import { createRequireSession, type SessionEnv } from './middleware/require-session'

const GRANT_TTL_MS = 5 * 60 * 1000
const GRANT_CODE_BYTES = 18

interface PendingGrant {
  code: string
  expiresAt: number
  status: 'pending' | 'ready' | 'expired'
  apiKey?: string
  userId?: string
  baseUrl?: string
}

const grants = new Map<string, PendingGrant>()

function generateGrantCode(): string {
  const bytes = new Uint8Array(GRANT_CODE_BYTES)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function reapExpired(): void {
  const now = Date.now()
  for (const [code, grant] of grants) {
    if (grant.expiresAt < now) {
      grant.status = 'expired'
      // Drop after a grace period so polls can see the expired state once.
      if (grant.expiresAt + GRANT_TTL_MS < now) grants.delete(code)
    }
  }
}

/** Cleared between tests via `__resetCliGrantsForTests`. */
export function __resetCliGrantsForTests(): void {
  grants.clear()
}

export interface CliGrantRouteOpts {
  auth: Auth
  db: ScopedDb
  /** Public origin used to build the confirmation URL (e.g. `https://acme.vobase.app`). */
  publicBaseUrl: string
}

export function createCliGrantRoutes(opts: CliGrantRouteOpts): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>()
  const requireSession = createRequireSession(opts.auth)

  // CLI: start a grant. No auth required — the code itself is the bearer.
  // biome-ignore lint/suspicious/useAwait: Hono handlers must be async per route signature
  app.post('/cli-grant', async (c) => {
    reapExpired()
    const code = generateGrantCode()
    const expiresAt = Date.now() + GRANT_TTL_MS
    grants.set(code, { code, expiresAt, status: 'pending' })
    return c.json({
      code,
      url: `${opts.publicBaseUrl.replace(/\/$/, '')}/auth/cli-grant?code=${code}`,
      ttlMs: GRANT_TTL_MS,
      expiresAt: new Date(expiresAt).toISOString(),
    })
  })

  // Browser: confirm grant, mint an API key bound to the signed-in user.
  app.post('/cli-grant/confirm', requireSession, async (c) => {
    reapExpired()
    const body = (await c.req.json().catch(() => ({}))) as { code?: unknown; name?: unknown }
    const code = typeof body.code === 'string' ? body.code : ''
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'CLI'
    const grant = grants.get(code)
    if (!grant) return c.json({ error: 'unknown_or_expired_code' }, 404)
    if (grant.status !== 'pending') return c.json({ error: `grant_${grant.status}` }, 410)

    const session = c.get('session')
    const created = await createApiKey({ db: opts.db, userId: session.user.id, name })
    grant.apiKey = created.key
    grant.userId = session.user.id
    grant.baseUrl = opts.publicBaseUrl
    grant.status = 'ready'
    return c.json({ ok: true, apiKeyId: created.id })
  })

  // CLI: poll for completion. Returns the API key once on `ready`.
  // biome-ignore lint/suspicious/useAwait: Hono handlers must be async per route signature
  app.get('/cli-grant/poll', async (c) => {
    reapExpired()
    const code = c.req.query('code') ?? ''
    const grant = grants.get(code)
    if (!grant) return c.json({ status: 'expired' }, 404)
    if (grant.status === 'pending') return c.json({ status: 'pending' })
    if (grant.status === 'expired') return c.json({ status: 'expired' }, 410)
    // Ready — return the key, then drop the grant so it's single-use.
    const payload = { status: 'ready' as const, apiKey: grant.apiKey, baseUrl: grant.baseUrl }
    grants.delete(code)
    return c.json(payload)
  })

  return app
}

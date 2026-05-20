import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { AppSession, SessionEnv } from '@auth/middleware/require-session'
import { __resetApiKeysServiceForTests, installApiKeysService } from '@modules/settings/service/api-keys'
import {
  __resetNotificationPrefsServiceForTests,
  installNotificationPrefsService,
} from '@modules/settings/service/notification-prefs'
import { Hono } from 'hono'

import settingsRouter from './index'

beforeAll(() => {
  installApiKeysService({
    list: async () => [
      {
        id: 'apk_existing',
        name: 'existing',
        prefix: 'vbt_',
        start: 'wxyz',
        enabled: true,
        lastRequest: null,
        createdAt: new Date(),
      },
    ],
    create: async (_headers, name) => ({
      id: 'apk_test',
      name,
      prefix: 'vbt_',
      start: 'abcd',
      enabled: true,
      lastRequest: null,
      createdAt: new Date(),
      key: 'vbt_abcdefghijklmnopqrstuvwxyz',
    }),
    revoke: async () => true,
  })
  installNotificationPrefsService({
    get: async (userId) => ({
      userId,
      prefs: {
        mention: { in_app: true, whatsapp: false, email: false },
        decision: { in_app: true, whatsapp: false, email: false },
        admin_alert: { in_app: true, whatsapp: false, email: false },
      },
      notifyWhileOnline: false,
      updatedAt: new Date(),
    }),
    upsert: async (userId, matrix, notifyWhileOnline) => ({
      userId,
      prefs: matrix,
      notifyWhileOnline,
      updatedAt: new Date(),
    }),
    isEnabled: async (_userId, _kind, channel) => ({ in_app: true, whatsapp: false, email: false })[channel] ?? false,
  })
})

afterAll(() => {
  __resetNotificationPrefsServiceForTests()
  __resetApiKeysServiceForTests()
})

const app = new Hono<SessionEnv>()
app.use('/settings/*', async (c, next) => {
  c.set('session', {
    user: {
      id: 'test-user',
      email: 'test@example.com',
      emailVerified: true,
      name: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: 'sess-1',
      userId: 'test-user',
      token: 'tok',
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      activeOrganizationId: null,
    },
  } satisfies AppSession)
  await next()
})
app.route('/settings', settingsRouter)

const POST = (path: string, body: unknown) =>
  app.request(`/settings${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// ── /profile ──────────────────────────────────────────────────────────────────

describe('POST /settings/profile', () => {
  it('happy path: valid body returns 200 + {ok:true}', async () => {
    const res = await POST('/profile', { displayName: 'Alice', email: 'alice@example.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejection: invalid email returns 400', async () => {
    const res = await POST('/profile', { email: 'not-an-email' })
    expect(res.status).toBe(400)
  })
})

// ── /notifications ────────────────────────────────────────────────────────────

describe('POST /settings/notifications', () => {
  it('happy path: valid matrix returns 200 + matrix echo', async () => {
    const res = await POST('/notifications', {
      matrix: { decision: { whatsapp: true, email: false } },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { matrix: { decision?: { whatsapp?: boolean } } }
    expect(json.matrix.decision?.whatsapp).toBe(true)
  })

  it('persists notifyWhileOnline', async () => {
    const res = await POST('/notifications', { matrix: {}, notifyWhileOnline: true })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { notifyWhileOnline?: boolean }
    expect(json.notifyWhileOnline).toBe(true)
  })

  it('rejection: string where boolean expected returns 400', async () => {
    const res = await POST('/notifications', { matrix: { mention: { in_app: 'yes' } } })
    expect(res.status).toBe(400)
  })
})

// ── /api-keys ─────────────────────────────────────────────────────────────────

describe('POST /settings/api-keys', () => {
  it('happy path: valid body returns the created key (plaintext shown once)', async () => {
    const res = await POST('/api-keys', { name: 'my-key' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; name: string; key: string }
    expect(body.name).toBe('my-key')
    expect(body.key).toMatch(/^vbt_/)
  })

  it('rejection: missing required name field returns 400', async () => {
    const res = await POST('/api-keys', {})
    expect(res.status).toBe(400)
  })
})

describe('GET /settings/api-keys', () => {
  it('lists summaries without ever leaking the plaintext key', async () => {
    const res = await app.request('/settings/api-keys')
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<Record<string, unknown>>
    expect(Array.isArray(rows)).toBe(true)
    for (const row of rows) {
      expect(Object.hasOwn(row, 'key')).toBe(false)
    }
  })
})

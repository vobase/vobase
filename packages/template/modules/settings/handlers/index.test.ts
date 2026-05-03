import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { AppSession, SessionEnv } from '@auth/middleware/require-session'
import {
  __resetNotificationPrefsServiceForTests,
  installNotificationPrefsService,
} from '@modules/settings/service/notification-prefs'
import { Hono } from 'hono'

import settingsRouter from './index'

beforeAll(() => {
  installNotificationPrefsService({
    get: async (userId) => ({
      userId,
      mentionsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      updatedAt: new Date(),
    }),
    upsert: async (userId, patch) => ({
      userId,
      mentionsEnabled: patch.mentionsEnabled ?? true,
      whatsappEnabled: patch.whatsappEnabled ?? false,
      emailEnabled: patch.emailEnabled ?? false,
      updatedAt: new Date(),
    }),
  })
})

afterAll(() => {
  __resetNotificationPrefsServiceForTests()
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

// ── /appearance ───────────────────────────────────────────────────────────────

describe('POST /settings/appearance', () => {
  it('happy path: valid body returns 200 + {ok:true}', async () => {
    const res = await POST('/appearance', { theme: 'dark', fontSize: 'md' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejection: invalid theme enum returns 400', async () => {
    const res = await POST('/appearance', { theme: 'retro' })
    expect(res.status).toBe(400)
  })
})

// ── /notifications ────────────────────────────────────────────────────────────

describe('POST /settings/notifications', () => {
  it('happy path: valid body returns 200 + prefs row', async () => {
    const res = await POST('/notifications', { emailEnabled: true, whatsappEnabled: false })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { userId: string; emailEnabled: boolean }
    expect(json.userId).toBe('test-user')
    expect(json.emailEnabled).toBe(true)
  })

  it('rejection: string where boolean expected returns 400', async () => {
    const res = await POST('/notifications', { emailEnabled: 'yes' })
    expect(res.status).toBe(400)
  })
})

// ── /display ──────────────────────────────────────────────────────────────────

describe('POST /settings/display', () => {
  it('happy path: valid body returns 200 + {ok:true}', async () => {
    const res = await POST('/display', { density: 'compact', showAvatars: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejection: invalid density enum returns 400', async () => {
    const res = await POST('/display', { density: 'cozy' })
    expect(res.status).toBe(400)
  })
})

// ── /api-keys ─────────────────────────────────────────────────────────────────

describe('POST /settings/api-keys', () => {
  it('happy path: valid body returns 200 + {ok:true}', async () => {
    const res = await POST('/api-keys', { name: 'my-key', scope: 'read' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejection: missing required name field returns 400', async () => {
    const res = await POST('/api-keys', { scope: 'read' })
    expect(res.status).toBe(400)
  })
})

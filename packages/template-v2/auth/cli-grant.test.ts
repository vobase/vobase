import { afterEach, describe, expect, it } from 'bun:test'

import { __resetCliGrantsForTests, createCliGrantRoutes } from './cli-grant'

afterEach(() => __resetCliGrantsForTests())

// The confirm endpoint requires a real `Auth` + DB; that path is covered by
// the e2e suite. These tests exercise the start + poll lifecycle and expiry
// behavior, which are pure logic against the in-memory grant store.
function makeApp() {
  // biome-ignore lint/suspicious/noExplicitAny: stubs for unit-only paths
  const auth = {} as any
  // biome-ignore lint/suspicious/noExplicitAny: stubs for unit-only paths
  const db = {} as any
  return createCliGrantRoutes({ auth, db, publicBaseUrl: 'https://acme.test' })
}

describe('cli-grant start', () => {
  it('issues a grant code with the confirmation URL and TTL', async () => {
    const app = makeApp()
    const res = await app.request('/cli-grant', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { code: string; url: string; ttlMs: number; expiresAt: string }
    expect(body.code).toMatch(/^[a-z0-9]{24}$/u)
    expect(body.url).toBe(`https://acme.test/auth/cli-grant?code=${body.code}`)
    expect(body.ttlMs).toBe(5 * 60 * 1000)
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('produces a fresh code on each call', async () => {
    const app = makeApp()
    const a = (await (await app.request('/cli-grant', { method: 'POST' })).json()) as { code: string }
    const b = (await (await app.request('/cli-grant', { method: 'POST' })).json()) as { code: string }
    expect(a.code).not.toBe(b.code)
  })
})

describe('cli-grant poll', () => {
  it('returns pending while no confirmation has happened', async () => {
    const app = makeApp()
    const start = (await (await app.request('/cli-grant', { method: 'POST' })).json()) as { code: string }
    const res = await app.request(`/cli-grant/poll?code=${start.code}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('pending')
  })

  it('returns 404 status=expired when the code is unknown', async () => {
    const app = makeApp()
    const res = await app.request('/cli-grant/poll?code=does-not-exist')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('expired')
  })
})

import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Auth } from '../auth'
import { createRequireSession, type SessionEnv } from './require-session'

function fakeAuth(session: unknown): Auth {
  return { api: { getSession: async () => session } } as unknown as Auth
}

describe('createRequireSession', () => {
  it('401s when getSession returns null', async () => {
    const app = new Hono<SessionEnv>()
    app.use('*', createRequireSession(fakeAuth(null)))
    app.get('/', (c) => c.text('ok'))
    const res = await app.request('/')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('sets session on ctx and calls next when authenticated', async () => {
    const session = { user: { id: 'u1' }, session: { activeOrganizationId: 'o1' } }
    const app = new Hono<SessionEnv>()
    app.use('*', createRequireSession(fakeAuth(session)))
    app.get('/', (c) => c.json({ seen: c.get('session') }))
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ seen: session })
  })
})

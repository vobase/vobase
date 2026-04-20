import { describe, expect, it } from 'bun:test'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { Hono, type MiddlewareHandler } from 'hono'
import { createRequireRole, type RoleEnv } from './require-role'

function fakeDb(role: string | null): ScopedDb {
  const chain = { limit: async () => (role ? [{ role }] : []) }
  return {
    select: () => ({ from: () => ({ where: () => chain }) }),
  } as unknown as ScopedDb
}

const wireCtx: MiddlewareHandler = async (c, next) => {
  c.set('session', { user: { id: 'u1' }, session: {} } as never)
  c.set('organizationId', 'org-1')
  await next()
}

describe('createRequireRole', () => {
  it('403s when user is not a member', async () => {
    const app = new Hono<RoleEnv>()
    app.use('*', wireCtx)
    app.use('*', createRequireRole(fakeDb(null), ['owner']))
    app.get('/', (c) => c.text('ok'))
    const res = await app.request('/')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not a member of organization' })
  })

  it('403s when role is not in allowlist', async () => {
    const app = new Hono<RoleEnv>()
    app.use('*', wireCtx)
    app.use('*', createRequireRole(fakeDb('member'), ['owner', 'admin']))
    app.get('/', (c) => c.text('ok'))
    const res = await app.request('/')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'insufficient role' })
  })

  it('passes with single matching role', async () => {
    const app = new Hono<RoleEnv>()
    app.use('*', wireCtx)
    app.use('*', createRequireRole(fakeDb('owner'), ['owner']))
    app.get('/', (c) => c.json({ role: c.get('memberRole') }))
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ role: 'owner' })
  })

  it('splits comma-separated roles and matches any', async () => {
    const app = new Hono<RoleEnv>()
    app.use('*', wireCtx)
    app.use('*', createRequireRole(fakeDb('member, admin'), ['admin']))
    app.get('/', (c) => c.json({ role: c.get('memberRole') }))
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ role: 'admin' })
  })
})

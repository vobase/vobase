import { describe, expect, it } from 'bun:test'
import { Hono, type MiddlewareHandler } from 'hono'

import type { Auth } from '../auth'
import type { OrganizationEnv } from './require-organization'
import { createRequirePermission } from './require-permission'

function fakeAuth(result: { success?: boolean; hasPermission?: boolean } | null): Auth {
  return { api: { hasPermission: async () => result } } as unknown as Auth
}

const wireCtx: MiddlewareHandler = async (c, next) => {
  c.set('session', { user: { id: 'u1' }, session: {} } as never)
  c.set('organizationId', 'org-1')
  await next()
}

describe('createRequirePermission', () => {
  it('403s when hasPermission returns { success: false }', async () => {
    const app = new Hono<OrganizationEnv>()
    app.use('*', wireCtx)
    app.use('*', createRequirePermission(fakeAuth({ success: false }), { posts: ['create'] }))
    app.get('/', (c) => c.text('ok'))
    const res = await app.request('/')
    expect(res.status).toBe(403)
  })

  it('passes when hasPermission returns { success: true }', async () => {
    const app = new Hono<OrganizationEnv>()
    app.use('*', wireCtx)
    app.use('*', createRequirePermission(fakeAuth({ success: true }), { posts: ['create'] }))
    app.get('/', (c) => c.text('ok'))
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  it('tolerates legacy hasPermission key shape', async () => {
    const app = new Hono<OrganizationEnv>()
    app.use('*', wireCtx)
    app.use('*', createRequirePermission(fakeAuth({ hasPermission: true }), { posts: ['create'] }))
    app.get('/', (c) => c.text('ok'))
    const res = await app.request('/')
    expect(res.status).toBe(200)
  })
})

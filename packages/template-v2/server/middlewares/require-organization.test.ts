import { describe, expect, it } from 'bun:test'
import { Hono, type MiddlewareHandler } from 'hono'
import { type OrganizationEnv, requireOrganization } from './require-organization'
import type { AppSession } from './require-session'

function setSession(session: AppSession): MiddlewareHandler {
  return async (c, next) => {
    c.set('session', session)
    await next()
  }
}

const baseSession = { user: { id: 'u1' } } as unknown as AppSession

describe('requireOrganization', () => {
  it('403s when activeOrganizationId is missing', async () => {
    const app = new Hono<OrganizationEnv>()
    app.use('*', setSession({ ...baseSession, session: { activeOrganizationId: null } as AppSession['session'] }))
    app.use('*', requireOrganization)
    app.get('/', (c) => c.text('ok'))
    const res = await app.request('/')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'no active organization' })
  })

  it('sets organizationId on ctx when present', async () => {
    const app = new Hono<OrganizationEnv>()
    app.use('*', setSession({ ...baseSession, session: { activeOrganizationId: 'org-42' } as AppSession['session'] }))
    app.use('*', requireOrganization)
    app.get('/', (c) => c.json({ org: c.get('organizationId') }))
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ org: 'org-42' })
  })
})

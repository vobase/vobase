/**
 * Unit test for the contacts agent-view route — uses the contacts service
 * stub to verify the response shape (files keyed off profile + notes).
 */

import { afterEach, describe, expect, it } from 'bun:test'
import type { OrganizationEnv } from '@auth/middleware'
import type { Contact } from '@modules/contacts/schema'
import type { ContactsService } from '@modules/contacts/service/contacts'
import * as contactsSvc from '@modules/contacts/service/contacts'
import { Hono } from 'hono'

import agentViewHandler from './agent-view'

const ORG_ID = 'org_acme'

function fakeContact(overrides: Partial<Contact>): Contact {
  return {
    id: overrides.id ?? 'cnt_1',
    organizationId: overrides.organizationId ?? ORG_ID,
    displayName: overrides.displayName ?? null,
    email: overrides.email ?? null,
    phone: overrides.phone ?? null,
    segments: overrides.segments ?? [],
    profile: overrides.profile ?? '',
    notes: overrides.notes ?? '',
    attributes: overrides.attributes ?? {},
    marketingOptOut: overrides.marketingOptOut ?? false,
    marketingOptOutAt: overrides.marketingOptOutAt ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  } as Contact
}

function installContactsStub(initial: Contact, notes: string): void {
  contactsSvc.installContactsService({
    get: (id: string) => Promise.resolve({ ...initial, id }),
    readNotes: () => Promise.resolve(notes),
  } as unknown as ContactsService)
}

function buildApp(): Hono<OrganizationEnv> {
  // Stub the session that requireOrganization reads — we bypass DB lookup
  // by pre-populating activeOrganizationId so the middleware short-circuits.
  return new Hono<OrganizationEnv>()
    .use('*', async (c, next) => {
      // biome-ignore lint/suspicious/noExplicitAny: intentional test stub
      c.set(
        'session' as never,
        {
          session: { activeOrganizationId: ORG_ID },
          user: { id: 'usr_test' },
        } as unknown as never,
      )
      return await next()
    })
    .route('/', agentViewHandler)
}

afterEach(() => {
  contactsSvc.__resetContactsServiceForTests()
})

describe('contacts agent-view', () => {
  it('returns profile + memory files when both are populated', async () => {
    installContactsStub(fakeContact({ id: 'cnt_1', profile: '# About\n\nLikes coffee.' }), '## 2026-04-26\n\nNotes')
    const app = buildApp()
    const res = await app.request('/cnt_1/agent-view', { method: 'GET' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { scope: string; files: Array<{ path: string; content: string }> }
    expect(body.scope).toBe('/contacts/cnt_1')
    expect(body.files.map((f) => f.path)).toEqual(['/profile.md', '/MEMORY.md'])
    expect(body.files[0].content).toContain('Likes coffee')
    expect(body.files[1].content).toContain('Notes')
  })

  it('omits empty files entirely', async () => {
    installContactsStub(fakeContact({ id: 'cnt_2', profile: '' }), '')
    const app = buildApp()
    const res = await app.request('/cnt_2/agent-view', { method: 'GET' })
    const body = (await res.json()) as { files: unknown[] }
    expect(body.files).toEqual([])
  })

  it('returns 404 when the contact lives in a different organization', async () => {
    installContactsStub(fakeContact({ id: 'cnt_x', organizationId: 'org_other' }), '')
    const app = buildApp()
    const res = await app.request('/cnt_x/agent-view', { method: 'GET' })
    expect(res.status).toBe(404)
  })
})

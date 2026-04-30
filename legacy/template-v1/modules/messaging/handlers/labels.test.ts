import { beforeEach, describe, expect, it } from 'bun:test'
import type { PGlite } from '@electric-sql/pglite'
import type { VobaseDb } from '@vobase/core'
import { Hono } from 'hono'

import { createTestDb } from '../../../lib/test-helpers'
import { channelInstances, channelRoutings, contacts, conversations } from '../schema'
import { labelsHandlers } from './labels'

let _pglite: PGlite
let db: VobaseDb

function buildApp(testDb: VobaseDb): Hono {
  const app = new Hono()

  // Inject db + user into Hono context before routes
  app.use('*', async (c, next) => {
    c.set('db', testDb)
    c.set('user', {
      id: 'test-user',
      email: 'test@example.com',
      name: 'Test',
      role: 'admin',
    })
    await next()
  })

  app.route('/', labelsHandlers)
  return app
}

let app: Hono

beforeEach(async () => {
  const result = await createTestDb()
  _pglite = result.pglite as unknown as PGlite
  db = result.db
  app = buildApp(db)

  // Seed a contact + channel + routing + conversation for label attachment tests
  await db.insert(contacts).values({
    id: 'lbl-contact',
    phone: '+6599999999',
    name: 'Label Tester',
    role: 'customer',
  })

  await db.insert(channelInstances).values({
    id: 'lbl-ci',
    type: 'web',
    label: 'Web',
    source: 'env',
    status: 'active',
  })

  await db.insert(channelRoutings).values({
    id: 'lbl-cr',
    name: 'Web Routing',
    channelInstanceId: 'lbl-ci',
    agentId: 'booking',
  })

  await db.insert(conversations).values({
    id: 'lbl-conv',
    channelRoutingId: 'lbl-cr',
    contactId: 'lbl-contact',
    agentId: 'booking',
    channelInstanceId: 'lbl-ci',
    assignee: 'agent:booking',
    status: 'active',
  })
})

describe('Labels CRUD', () => {
  it('POST /labels creates a label', async () => {
    const res = await app.request('/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Urgent', color: '#ff0000' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('Urgent')
    expect(body.color).toBe('#ff0000')
    expect(body.id).toBeTruthy()
  })

  it('GET /labels returns created labels', async () => {
    // Create two labels first
    await app.request('/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bug' }),
    })
    await app.request('/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Feature' }),
    })

    const res = await app.request('/labels')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(2)
    const titles = body.map((l: { title: string }) => l.title)
    expect(titles).toContain('Bug')
    expect(titles).toContain('Feature')
  })

  it('PATCH /labels/:id updates a label', async () => {
    const createRes = await app.request('/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'OldTitle' }),
    })
    const created = await createRes.json()

    const res = await app.request(`/labels/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'NewTitle', color: '#00ff00' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe('NewTitle')
    expect(body.color).toBe('#00ff00')
  })

  it('DELETE /labels/:id deletes a label', async () => {
    const createRes = await app.request('/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'ToDelete' }),
    })
    const created = await createRes.json()

    const deleteRes = await app.request(`/labels/${created.id}`, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)
    const body = await deleteRes.json()
    expect(body.ok).toBe(true)

    // Confirm gone
    const listRes = await app.request('/labels')
    const list = await listRes.json()
    expect(list.find((l: { id: string }) => l.id === created.id)).toBeUndefined()
  })
})

describe('Conversation Labels', () => {
  async function createLabel(title: string): Promise<string> {
    const res = await app.request('/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    const body = await res.json()
    return body.id as string
  }

  it('POST /conversations/:id/labels attaches labels', async () => {
    const lid = await createLabel('VIP')

    const res = await app.request('/conversations/lbl-conv/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labelIds: [lid] }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('GET /conversations/:id/labels returns attached labels', async () => {
    const lid1 = await createLabel('Priority')
    const lid2 = await createLabel('Billing')

    await app.request('/conversations/lbl-conv/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labelIds: [lid1, lid2] }),
    })

    const res = await app.request('/conversations/lbl-conv/labels')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(2)
    const titles = body.map((l: { title: string }) => l.title)
    expect(titles).toContain('Priority')
    expect(titles).toContain('Billing')
  })

  it('DELETE /conversations/:id/labels/:lid removes label', async () => {
    const lid = await createLabel('Temporary')

    await app.request('/conversations/lbl-conv/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labelIds: [lid] }),
    })

    const deleteRes = await app.request(`/conversations/lbl-conv/labels/${lid}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)
    const body = await deleteRes.json()
    expect(body.ok).toBe(true)

    const listRes = await app.request('/conversations/lbl-conv/labels')
    const list = await listRes.json()
    expect(list.length).toBe(0)
  })
})

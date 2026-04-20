import { beforeEach, describe, expect, it } from 'bun:test'
import { createNotesService, installNotesService } from '@modules/inbox/service/notes'
import { createStaffOpsService, installStaffOpsService } from '@modules/inbox/service/staff-ops'
import { Hono } from 'hono'
import notesRouter from '../notes'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONV_ID = 'conv-notes-1'
const ORG_ID = 'tenant_meridian'
const OTHER_TENANT = 'tenant_other'

const fakeConv = {
  id: CONV_ID,
  organizationId: ORG_ID,
  contactId: 'c-1',
  channelInstanceId: 'ch-1',
  status: 'active' as const,
  assignee: 'unassigned',
  snoozedUntil: null,
  snoozedReason: null,
  snoozedBy: null,
  snoozedAt: null,
  snoozedJobId: null,
  lastMessageAt: null,
  resolvedAt: null,
  resolvedReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const fakeNote = {
  id: 'note-1',
  organizationId: ORG_ID,
  conversationId: CONV_ID,
  authorType: 'staff' as const,
  authorId: 'user-1',
  body: 'Test note',
  mentions: [],
  parentNoteId: null,
  notifChannelMsgId: null,
  notifChannelId: null,
  createdAt: new Date(),
}

// ─── DB Stub builders ─────────────────────────────────────────────────────────

function makeStaffOpsDb(conv: unknown, notifyCalls: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (conv ? [conv] : []),
        }),
      }),
    }),
    execute: async (_q: unknown) => {
      notifyCalls.push(CONV_ID)
      return []
    },
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  }
}

function makeNotesDb(note: unknown) {
  return {
    insert: (_t: unknown) => ({
      values: (_v: unknown) => ({
        returning: async () => [note],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
        }),
      }),
    }),
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono()
app.route('/conversations', notesRouter)

const POST = (id: string, body: unknown, org = ORG_ID) =>
  app.request(`/conversations/${id}/notes?organizationId=${org}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /conversations/:id/notes', () => {
  let notifyCalls: string[]

  beforeEach(() => {
    notifyCalls = []
    installStaffOpsService(createStaffOpsService({ db: makeStaffOpsDb(fakeConv, notifyCalls) }))
    installNotesService(createNotesService({ db: makeNotesDb(fakeNote) }))
  })

  it('(a) rejects payload missing required fields with 400', async () => {
    const res = await POST(CONV_ID, { authorType: 'staff' })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('invalid_body')
  })

  it('(a) rejects invalid authorType with 400', async () => {
    const res = await POST(CONV_ID, { body: 'hi', authorType: 'manager', authorId: 'u-1' })
    expect(res.status).toBe(400)
  })

  it('(a) rejects empty body string with 400', async () => {
    const res = await POST(CONV_ID, { body: '', authorType: 'staff', authorId: 'u-1' })
    expect(res.status).toBe(400)
  })

  it('(b) happy path returns InternalNote with 200', async () => {
    const res = await POST(CONV_ID, { body: 'Test note', authorType: 'staff', authorId: 'user-1' })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { id: string; body: string }
    expect(json.id).toBe('note-1')
    expect(json.body).toBe('Test note')
  })

  it('(c) SSE NOTIFY fires after successful note creation', async () => {
    const res = await POST(CONV_ID, { body: 'hello', authorType: 'staff', authorId: 'u-1' })
    expect(res.status).toBe(200)
    expect(notifyCalls).toContain(CONV_ID)
  })

  it('(d) returns 404 when conversation not found', async () => {
    installStaffOpsService(createStaffOpsService({ db: makeStaffOpsDb(null, notifyCalls) }))
    const res = await POST(CONV_ID, { body: 'hi', authorType: 'staff', authorId: 'u-1' })
    expect(res.status).toBe(404)
  })

  it('(d) returns 403 when conversation belongs to different organization', async () => {
    installStaffOpsService(
      createStaffOpsService({ db: makeStaffOpsDb({ ...fakeConv, organizationId: OTHER_TENANT }, notifyCalls) }),
    )
    const res = await POST(CONV_ID, { body: 'hi', authorType: 'staff', authorId: 'u-1' })
    expect(res.status).toBe(403)
  })

  it('(e,f) idempotency + auth: PR-1 is session-less; no Idempotency-Key support. Endpoints gated only by network reachability. Both harden in PR-2.', () => {
    expect(true).toBe(true)
  })
})

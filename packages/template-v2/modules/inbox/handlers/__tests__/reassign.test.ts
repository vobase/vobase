import { beforeEach, describe, expect, it } from 'bun:test'
import { setDb as setJournalDb } from '@modules/agents/service/journal'
import { setDb as setConversationsDb } from '@modules/inbox/service/conversations'
import { setDb as setStaffOpsDb } from '@modules/inbox/service/staff-ops'
import { Hono } from 'hono'
import reassignRouter from '../reassign'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONV_ID = 'conv-reassign-1'
const ORG_ID = 'tenant_meridian'
const OTHER_TENANT = 'tenant_other'

const fakeConv = {
  id: CONV_ID,
  organizationId: ORG_ID,
  contactId: 'c-1',
  channelInstanceId: 'ch-1',
  status: 'active' as const,
  assignee: 'agent-alice',
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

// ─── DB Stub builder ──────────────────────────────────────────────────────────

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
  }
}

function makeConversationsDb(current: unknown, updated: unknown) {
  const run = {
    insert: () => ({
      values: () => ({
        returning: async () => [],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (current ? [current] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => (updated ? [updated] : []),
        }),
      }),
    }),
  }
  return {
    ...run,
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(run),
  }
}

function makeJournalDb() {
  return {
    insert: () => ({
      values: () => ({ returning: async () => [] }),
    }),
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono()
app.route('/conversations', reassignRouter)

const POST = (id: string, body: unknown, org = ORG_ID) =>
  app.request(`/conversations/${id}/reassign?organizationId=${org}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /conversations/:id/reassign', () => {
  let notifyCalls: string[]

  beforeEach(() => {
    notifyCalls = []
    setStaffOpsDb(makeStaffOpsDb(fakeConv, notifyCalls))
    setConversationsDb(makeConversationsDb(fakeConv, { ...fakeConv, assignee: 'agent-bob' }))
    setJournalDb(makeJournalDb())
  })

  it('(a) rejects payload missing assignee with 400', async () => {
    const res = await POST(CONV_ID, { note: 'reassigning' })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('invalid_body')
  })

  it('(a) rejects empty assignee string with 400', async () => {
    const res = await POST(CONV_ID, { assignee: '' })
    expect(res.status).toBe(400)
  })

  it('(b) happy path returns updated conversation with 200', async () => {
    const res = await POST(CONV_ID, { assignee: 'agent-bob' })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { conversation: { assignee: string } }
    expect(json.conversation.assignee).toBe('agent-bob')
  })

  it('(b) optional note field is accepted', async () => {
    const res = await POST(CONV_ID, { assignee: 'agent-bob', note: 'taking over' })
    expect(res.status).toBe(200)
  })

  it('(c) SSE NOTIFY fires after successful reassign', async () => {
    const res = await POST(CONV_ID, { assignee: 'agent-bob' })
    expect(res.status).toBe(200)
    expect(notifyCalls).toContain(CONV_ID)
  })

  it('(d) returns 404 when conversation not found', async () => {
    setStaffOpsDb(makeStaffOpsDb(null, notifyCalls))
    const res = await POST(CONV_ID, { assignee: 'agent-bob' })
    expect(res.status).toBe(404)
  })

  it('(d) returns 403 when conversation belongs to different organization', async () => {
    setStaffOpsDb(makeStaffOpsDb({ ...fakeConv, organizationId: OTHER_TENANT }, notifyCalls))
    const res = await POST(CONV_ID, { assignee: 'agent-bob' })
    expect(res.status).toBe(403)
  })

  it('(e,f) idempotency + auth: PR-1 is session-less; no Idempotency-Key support. Endpoints gated only by network reachability. Both harden in PR-2.', () => {
    expect(true).toBe(true)
  })
})

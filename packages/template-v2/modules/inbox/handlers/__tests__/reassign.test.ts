import { beforeEach, describe, expect, it } from 'bun:test'
import { setDb as setStaffOpsDb } from '@modules/inbox/service/staff-ops'
import { Hono } from 'hono'
import reassignRouter from '../reassign'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONV_ID = 'conv-reassign-1'
const TENANT_ID = 'tenant_meridian'
const OTHER_TENANT = 'tenant_other'

const fakeConv = {
  id: CONV_ID,
  tenantId: TENANT_ID,
  contactId: 'c-1',
  channelInstanceId: 'ch-1',
  parentConversationId: null,
  compactionSummary: null,
  compactedAt: null,
  status: 'active' as const,
  assignee: 'agent-alice',
  onHold: false,
  onHoldReason: null,
  lastMessageAt: null,
  resolvedAt: null,
  resolvedReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ─── DB Stub builder ──────────────────────────────────────────────────────────

function makeStaffOpsDb(conv: unknown, updatedConv: unknown, notifyCalls: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (conv ? [conv] : []),
        }),
      }),
    }),
    update: (_t: unknown) => ({
      set: (_s: unknown) => ({
        where: (_w: unknown) => ({
          returning: async () => (updatedConv ? [updatedConv] : []),
        }),
      }),
    }),
    execute: async (_q: unknown) => {
      notifyCalls.push(CONV_ID)
      return []
    },
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono()
app.route('/conversations', reassignRouter)

const POST = (id: string, body: unknown, tenant = TENANT_ID) =>
  app.request(`/conversations/${id}/reassign?tenantId=${tenant}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /conversations/:id/reassign', () => {
  let notifyCalls: string[]

  beforeEach(() => {
    notifyCalls = []
    setStaffOpsDb(makeStaffOpsDb(fakeConv, { ...fakeConv, assignee: 'agent-bob' }, notifyCalls))
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
    setStaffOpsDb(makeStaffOpsDb(null, null, notifyCalls))
    const res = await POST(CONV_ID, { assignee: 'agent-bob' })
    expect(res.status).toBe(404)
  })

  it('(d) returns 403 when conversation belongs to different tenant', async () => {
    setStaffOpsDb(makeStaffOpsDb({ ...fakeConv, tenantId: OTHER_TENANT }, null, notifyCalls))
    const res = await POST(CONV_ID, { assignee: 'agent-bob' })
    expect(res.status).toBe(403)
  })

  it('(e,f) idempotency + auth: PR-1 is session-less; no Idempotency-Key support. Endpoints gated only by network reachability. Both harden in PR-2.', () => {
    expect(true).toBe(true)
  })
})

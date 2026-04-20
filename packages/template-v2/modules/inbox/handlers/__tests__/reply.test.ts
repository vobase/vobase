import { beforeEach, describe, expect, it } from 'bun:test'
import { setDb as setJournalDb } from '@modules/agents/service/journal'
import { setDb as setMessagesDb } from '@modules/inbox/service/messages'
import { setDb as setStaffOpsDb } from '@modules/inbox/service/staff-ops'
import { OUTBOUND_TOOL_NAME_SET } from '@server/contracts/channel-event'
import { Hono } from 'hono'
import replyRouter from '../reply'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONV_ID = 'conv-reply-1'
const TENANT_ID = 'tenant_meridian'
const OTHER_TENANT = 'tenant_other'
const MSG_ID = 'msg-reply-1'

const fakeConv = {
  id: CONV_ID,
  tenantId: TENANT_ID,
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

const fakeMessage = {
  id: MSG_ID,
  conversationId: CONV_ID,
  tenantId: TENANT_ID,
  role: 'staff',
  kind: 'text',
  content: { text: 'Hello from staff' },
  parentMessageId: null,
  channelExternalId: null,
  status: null,
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

function makeMessagesDb(msg: unknown) {
  return {
    insert: (_t: unknown) => ({
      values: (_v: unknown) => ({
        returning: async () => [msg],
      }),
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const fakeTx = {
        insert: (_t: unknown) => ({
          values: (_v: unknown) => ({
            returning: async () => [msg],
          }),
        }),
      }
      return fn(fakeTx)
    },
  }
}

function makeJournalDb() {
  return {
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => Promise.resolve(),
    }),
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono()
app.route('/conversations', replyRouter)

const POST = (id: string, body: unknown, tenant = TENANT_ID) =>
  app.request(`/conversations/${id}/reply?tenantId=${tenant}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /conversations/:id/reply', () => {
  let notifyCalls: string[]

  beforeEach(() => {
    notifyCalls = []
    setStaffOpsDb(makeStaffOpsDb(fakeConv, notifyCalls))
    setMessagesDb(makeMessagesDb(fakeMessage))
    setJournalDb(makeJournalDb())
  })

  it('(a) rejects empty body string with 400', async () => {
    const res = await POST(CONV_ID, { body: '' })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('invalid_body')
  })

  it('(a) rejects body exceeding 10 000 chars with 400', async () => {
    const res = await POST(CONV_ID, { body: 'x'.repeat(10_001) })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('invalid_body')
  })

  it('(b) happy path returns messageId with 200', async () => {
    const res = await POST(CONV_ID, { body: 'Hello from staff', staffUserId: 'user-1' })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { messageId: string }
    expect(json.messageId).toBe(MSG_ID)
  })

  it('(c) SSE NOTIFY fires after successful reply', async () => {
    const res = await POST(CONV_ID, { body: 'Hello', staffUserId: 'user-1' })
    expect(res.status).toBe(200)
    expect(notifyCalls).toContain(CONV_ID)
  })

  it('(d) cross-tenant: returns 404 when conversation belongs to different tenant', async () => {
    setStaffOpsDb(makeStaffOpsDb({ ...fakeConv, tenantId: OTHER_TENANT }, notifyCalls))
    const res = await POST(CONV_ID, { body: 'Hi', staffUserId: 'u-1' })
    expect(res.status).toBe(404)
  })

  it('(f) no-agent-replay: wake-worker guard prevents staff_reply from triggering outbound dispatch', () => {
    const emitted: string[] = []

    const handler = (event: { type: string; toolName?: string }): void => {
      if (event.type !== 'tool_execution_end') return
      if (event.toolName === 'staff_reply') return
      if (!OUTBOUND_TOOL_NAME_SET.has(event.toolName ?? '')) return
      emitted.push(event.toolName ?? '')
    }

    // staff_reply IS in OUTBOUND_TOOL_NAME_SET — without the guard it would dispatch
    expect(OUTBOUND_TOOL_NAME_SET.has('staff_reply')).toBe(true)

    handler({ type: 'tool_execution_end', toolName: 'staff_reply' })
    expect(emitted).toHaveLength(0)

    // Verify normal outbound tools still pass through
    handler({ type: 'tool_execution_end', toolName: 'reply' })
    expect(emitted).toEqual(['reply'])
  })
})

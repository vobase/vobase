/**
 * Unit test for sendStaffReply writer.
 * Verifies message + journal co-commit in one transaction.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { setDb as setJournalDb } from '@modules/agents/service/journal'
import { createMessagesService, installMessagesService } from '@modules/inbox/service/messages'
import type { Message } from '../../schema'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONV_ID = 'conv-sr-1'
const ORG_ID = 'tenant_meridian'
const STAFF_USER = 'user-staff-1'
const BODY = 'Staff reply text'

const fakeMessage: Message = {
  id: 'msg-sr-1',
  conversationId: CONV_ID,
  organizationId: ORG_ID,
  role: 'staff',
  kind: 'text',
  content: { text: BODY },
  parentMessageId: null,
  channelExternalId: null,
  status: null,
  createdAt: new Date(),
}

// ─── DB stub helpers ──────────────────────────────────────────────────────────

// Message inserts have `kind`; journal inserts have `type`. Use `kind` to detect message rows.
function isMessageInsert(vals: Record<string, unknown>): boolean {
  return 'kind' in vals
}

// Journal inserts have `toolName` set when the event is tool_execution_end.
function journalToolName(vals: Record<string, unknown>): string | undefined {
  if (!('type' in vals)) return undefined
  return (vals.toolName as string | undefined) ?? undefined
}

function makeTransactionDb(
  returnMsg: unknown,
  onMessageInsert?: (vals: Record<string, unknown>) => void,
  onJournalInsert?: (vals: Record<string, unknown>) => void,
) {
  return {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const fakeTx = {
        insert: (_table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            if (isMessageInsert(vals)) onMessageInsert?.(vals)
            else onJournalInsert?.(vals)
            return { returning: async () => [returnMsg] }
          },
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendStaffReply', () => {
  beforeEach(() => {
    installMessagesService(createMessagesService({ db: makeTransactionDb(fakeMessage) }))
    setJournalDb(makeJournalDb())
  })

  it('returns messageId matching inserted message', async () => {
    const { sendStaffReply } = await import('../staff-reply')
    const result = await sendStaffReply({
      conversationId: CONV_ID,
      organizationId: ORG_ID,
      staffUserId: STAFF_USER,
      body: BODY,
    })
    expect(result.messageId).toBe('msg-sr-1')
    expect(result.message.id).toBe('msg-sr-1')
  })

  it('inserts message with role=staff and kind=text', async () => {
    let capturedRole: unknown
    let capturedKind: unknown
    let capturedContent: unknown

    installMessagesService(
      createMessagesService({
        db: makeTransactionDb(fakeMessage, (vals) => {
          capturedRole = vals.role
          capturedKind = vals.kind
          capturedContent = vals.content
        }),
      }),
    )

    const { sendStaffReply } = await import('../staff-reply')
    await sendStaffReply({ conversationId: CONV_ID, organizationId: ORG_ID, staffUserId: STAFF_USER, body: BODY })
    expect(capturedRole).toBe('staff')
    expect(capturedKind).toBe('text')
    expect((capturedContent as Record<string, unknown>)?.text).toBe(BODY)
  })

  it('journals tool_execution_end with toolName=staff_reply atomically', async () => {
    let capturedToolName: unknown

    installMessagesService(
      createMessagesService({
        db: makeTransactionDb(fakeMessage, undefined, (vals) => {
          capturedToolName = journalToolName(vals)
        }),
      }),
    )

    const { sendStaffReply } = await import('../staff-reply')
    await sendStaffReply({ conversationId: CONV_ID, organizationId: ORG_ID, staffUserId: STAFF_USER, body: BODY })
    expect(capturedToolName).toBe('staff_reply')
  })
})

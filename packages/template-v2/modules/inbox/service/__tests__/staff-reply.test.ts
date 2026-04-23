/**
 * Unit test for sendStaffReply writer.
 * Verifies message + journal co-commit in one transaction.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { createMessagesService, installMessagesService } from '@modules/inbox/service/messages'
import { __resetStaffServiceForTests, installStaffService, type StaffService } from '@modules/team/service/staff'
import { setJournalDb } from '@vobase/core'
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

function makeStaffServiceStub(overrides: Partial<StaffService> = {}): StaffService {
  const notImplemented = async () => {
    throw new Error('not implemented in stub')
  }
  return {
    list: notImplemented as StaffService['list'],
    get: notImplemented as StaffService['get'],
    find: (async () => null) as StaffService['find'],
    upsert: notImplemented as StaffService['upsert'],
    update: notImplemented as StaffService['update'],
    remove: notImplemented as StaffService['remove'],
    setAttributes: notImplemented as StaffService['setAttributes'],
    touchLastSeen: (async () => undefined) as StaffService['touchLastSeen'],
    readNotes: notImplemented as StaffService['readNotes'],
    writeNotes: notImplemented as StaffService['writeNotes'],
    upsertNotesSection: notImplemented as StaffService['upsertNotesSection'],
    readProfile: notImplemented as StaffService['readProfile'],
    writeProfile: notImplemented as StaffService['writeProfile'],
    ...overrides,
  }
}

describe('sendStaffReply', () => {
  beforeEach(() => {
    installMessagesService(createMessagesService({ db: makeTransactionDb(fakeMessage) }))
    setJournalDb(makeJournalDb())
    __resetStaffServiceForTests()
    installStaffService(makeStaffServiceStub())
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

  it('prepends [displayName] when staff profile resolves', async () => {
    let capturedText: unknown

    installMessagesService(
      createMessagesService({
        db: makeTransactionDb(fakeMessage, (vals) => {
          capturedText = (vals.content as Record<string, unknown>)?.text
        }),
      }),
    )
    installStaffService(
      makeStaffServiceStub({
        find: (async () => ({ displayName: 'Alice Nguyen' })) as unknown as StaffService['find'],
      }),
    )

    const { sendStaffReply } = await import('../staff-reply')
    await sendStaffReply({ conversationId: CONV_ID, organizationId: ORG_ID, staffUserId: STAFF_USER, body: BODY })
    expect(capturedText).toBe(`[Alice Nguyen] ${BODY}`)
  })

  it('leaves body unchanged when it already starts with a bracketed prefix', async () => {
    let capturedText: unknown

    installMessagesService(
      createMessagesService({
        db: makeTransactionDb(fakeMessage, (vals) => {
          capturedText = (vals.content as Record<string, unknown>)?.text
        }),
      }),
    )
    installStaffService(
      makeStaffServiceStub({
        find: (async () => ({ displayName: 'Alice Nguyen' })) as unknown as StaffService['find'],
      }),
    )

    const prefixed = '[Override] already tagged'
    const { sendStaffReply } = await import('../staff-reply')
    await sendStaffReply({ conversationId: CONV_ID, organizationId: ORG_ID, staffUserId: STAFF_USER, body: prefixed })
    expect(capturedText).toBe(prefixed)
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

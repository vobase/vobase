/**
 * Unit test for sendStaffReply writer.
 * Verifies message + journal co-commit in one transaction.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { installOutboundService, type SendOutboundInput } from '@modules/channels/service/outbound'
import { createMessagesService, installMessagesService } from '@modules/messaging/service/messages'
import { __resetStaffServiceForTests, installStaffService, type StaffService } from '@modules/team/service/staff'
import { setJournalDb } from '@vobase/core'

import { LEARNING_TRIAGE_JOB } from '~/wake/learning/triage-job'
import type { Message } from '../schema'
import {
  __resetConversationsServiceForTests,
  createConversationsService,
  installConversationsService,
} from './conversations'
import {
  __resetStaffReplyTriageSchedulerForTests,
  installStaffReplyTriageScheduler,
  type StaffReplyTriageScheduler,
  sendStaffReply,
} from './staff-reply'

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
  attachments: [],
  metadata: {},
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
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
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

/**
 * Minimal ConversationsService stub that returns a conversation with the
 * given assignee. Used so `getConversation()` doesn't throw.
 */
function makeConversationsStub(assignee: string) {
  const fakeConv = {
    id: CONV_ID,
    organizationId: ORG_ID,
    contactId: 'contact-1',
    channelInstanceId: 'channel-1',
    assignee,
    status: 'active' as const,
    threadKey: 'default',
    snoozedUntil: null,
    snoozedAt: null,
    lastSnoozedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  return createConversationsService({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [fakeConv],
            orderBy: () => ({ limit: async () => [fakeConv] }),
          }),
          orderBy: () => ({ limit: async () => [fakeConv] }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: async () => [fakeConv] }) }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
      transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({} as unknown),
      execute: async () => [],
    },
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function makeStaffServiceStub(overrides: Partial<StaffService> = {}): StaffService {
  // biome-ignore lint/suspicious/useAwait: contract requires async signature
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
    readMemory: notImplemented as StaffService['readMemory'],
    writeMemory: notImplemented as StaffService['writeMemory'],
    upsertMemorySection: notImplemented as StaffService['upsertMemorySection'],
    readProfile: notImplemented as StaffService['readProfile'],
    writeProfile: notImplemented as StaffService['writeProfile'],
    ...overrides,
  }
}

describe('sendStaffReply', () => {
  let outboundCalls: SendOutboundInput[] = []

  beforeEach(() => {
    outboundCalls = []
    installConversationsService(makeConversationsStub('unassigned'))
    installMessagesService(createMessagesService({ db: makeTransactionDb(fakeMessage) }))
    setJournalDb(makeJournalDb())
    __resetStaffServiceForTests()
    installStaffService(makeStaffServiceStub())
    __resetStaffReplyTriageSchedulerForTests()
    installOutboundService({
      sendOutbound: (input) => {
        outboundCalls.push(input)
        return Promise.resolve({ success: true })
      },
    })
  })

  afterEach(() => {
    __resetConversationsServiceForTests()
    __resetStaffReplyTriageSchedulerForTests()
  })

  it('returns messageId matching inserted message', async () => {
    const result = await sendStaffReply({
      conversationId: CONV_ID,
      organizationId: ORG_ID,
      staffUserId: STAFF_USER,
      body: BODY,
    })
    expect(result.messageId).toBe('msg-sr-1')
    expect(result.message.id).toBe('msg-sr-1')
    expect(outboundCalls).toHaveLength(1)
    expect(outboundCalls[0]?.toolName).toBe('staff_reply')
    expect(outboundCalls[0]?.organizationId).toBe(ORG_ID)
    expect(outboundCalls[0]?.conversationId).toBe(CONV_ID)
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

    await sendStaffReply({ conversationId: CONV_ID, organizationId: ORG_ID, staffUserId: STAFF_USER, body: BODY })
    expect(capturedToolName).toBe('staff_reply')
  })

  describe('learning triage enqueue (staff_takeover)', () => {
    it('enqueues staff_takeover when conversation is assigned to an agent', async () => {
      installConversationsService(makeConversationsStub('agent:bot-1'))

      const published: Array<{ name: string; payload: unknown }> = []
      const sched: StaffReplyTriageScheduler = {
        publish: (name, payload) => {
          published.push({ name, payload })
          return Promise.resolve()
        },
      }
      installStaffReplyTriageScheduler(sched)

      await sendStaffReply({ conversationId: CONV_ID, organizationId: ORG_ID, staffUserId: STAFF_USER, body: BODY })

      // fire-and-forget — yield so the void promise resolves
      await Promise.resolve()

      expect(published).toHaveLength(1)
      const first = published[0]
      if (!first) throw new Error('expected one published item')
      expect(first.name).toBe(LEARNING_TRIAGE_JOB)
      const p = first.payload as Record<string, unknown>
      expect(p.organizationId).toBe(ORG_ID)
      expect(p.conversationId).toBe(CONV_ID)
      expect(p.agentId).toBe('bot-1')
      expect((p.signal as Record<string, unknown>).kind).toBe('staff_takeover')
      expect((p.signal as Record<string, unknown>).messageId).toBe('msg-sr-1')
    })

    it('does NOT enqueue when conversation is NOT assigned to an agent', async () => {
      installConversationsService(makeConversationsStub('unassigned'))

      const published: unknown[] = []
      installStaffReplyTriageScheduler({
        publish: (name, payload) => {
          published.push({ name, payload })
          return Promise.resolve()
        },
      })

      await sendStaffReply({ conversationId: CONV_ID, organizationId: ORG_ID, staffUserId: STAFF_USER, body: BODY })
      await Promise.resolve()

      expect(published).toHaveLength(0)
    })

    it('does NOT enqueue when triage scheduler is not installed', async () => {
      installConversationsService(makeConversationsStub('agent:bot-1'))
      // scheduler not installed — __resetStaffReplyTriageSchedulerForTests() already called in beforeEach

      // just verify sendStaffReply completes without error
      const result = await sendStaffReply({
        conversationId: CONV_ID,
        organizationId: ORG_ID,
        staffUserId: STAFF_USER,
        body: BODY,
      })
      expect(result.messageId).toBe('msg-sr-1')
    })

    it('uses raw input.body (not prefixed body) in the signal', async () => {
      installConversationsService(makeConversationsStub('agent:bot-1'))
      installStaffService(
        makeStaffServiceStub({
          find: (async () => ({ displayName: 'Alice Nguyen' })) as unknown as StaffService['find'],
        }),
      )

      const published: Array<{ name: string; payload: unknown }> = []
      installStaffReplyTriageScheduler({
        publish: (name, payload) => {
          published.push({ name, payload })
          return Promise.resolve()
        },
      })

      await sendStaffReply({ conversationId: CONV_ID, organizationId: ORG_ID, staffUserId: STAFF_USER, body: BODY })
      await Promise.resolve()

      expect(published).toHaveLength(1)
      const first = published[0]
      if (!first) throw new Error('expected one published item')
      // signal.body must be raw input.body, not the prefixed "[Alice Nguyen] ..." version
      expect((first.payload as Record<string, unknown>).signal).toMatchObject({ kind: 'staff_takeover', body: BODY })
    })
  })
})

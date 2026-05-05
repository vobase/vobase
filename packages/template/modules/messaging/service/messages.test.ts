/**
 * messages.ts unit tests — verifies appendCardReplyMessage atomic write path
 * and hasRecentAgentReply predicate.
 * Stubs the DB to avoid a real Postgres connection.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import * as core from '@vobase/core'

import type { Message } from '../schema'
import * as mod from './messages'
import { appendCardReplyMessage, createMessagesService, hasRecentAgentReply, installMessagesService } from './messages'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeParent: Message = {
  id: 'parent-card-1',
  conversationId: 'conv-1',
  organizationId: 'org-1',
  role: 'agent',
  kind: 'card',
  content: { card: { title: 'Test Card' } },
  parentMessageId: null,
  channelExternalId: null,
  status: null,
  attachments: [],
  metadata: {},
  createdAt: new Date(),
}

const fakeReplyRow: Message = {
  id: 'reply-msg-1',
  conversationId: 'conv-1',
  organizationId: 'org-1',
  role: 'customer',
  kind: 'card_reply',
  content: { buttonId: 'btn-yes', buttonValue: 'yes', buttonLabel: 'Yes' },
  parentMessageId: 'parent-card-1',
  channelExternalId: null,
  status: null,
  attachments: [],
  metadata: {},
  createdAt: new Date(),
}

// ─── DB stub helpers ──────────────────────────────────────────────────────────

function makeSelectDb(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
        orderBy: () => ({ limit: async () => rows }),
      }),
    }),
  }
}

function makeTxInsert(returnRow: unknown) {
  return (_table: unknown) => ({
    values: (_vals: unknown) => ({
      returning: async () => [returnRow],
    }),
  })
}

function makeDb(parentRows: unknown[], replyRow: unknown): unknown {
  return {
    select: () => makeSelectDb(parentRows),
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const fakeTx = {
        insert: makeTxInsert(replyRow),
        select: () => makeSelectDb(parentRows),
      }
      return fn(fakeTx)
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function makeJournalDb() {
  return {
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => Promise.resolve(),
    }),
  }
}

// biome-ignore lint/suspicious/useAwait: test setup may invoke async helpers
beforeEach(async () => {
  mod.installMessagesService(mod.createMessagesService({ db: makeDb([fakeParent], fakeReplyRow) }))

  core.setJournalDb(makeJournalDb())
})

describe('appendCardReplyMessage', () => {
  it('returns Message with kind card_reply', async () => {
    const result = (await appendCardReplyMessage({
      parentMessageId: 'parent-card-1',
      buttonId: 'btn-yes',
      buttonValue: 'yes',
      buttonLabel: 'Yes',
    })) as Message

    expect(result.kind).toBe('card_reply')
    expect(result.role).toBe('customer')
    expect(result.conversationId).toBe('conv-1')
    expect(result.organizationId).toBe('org-1')
  })

  it('inserts message inside transaction with correct content shape', async () => {
    let capturedKind: unknown
    let capturedRole: unknown
    let capturedContent: unknown
    let capturedParentId: unknown

    installMessagesService(
      createMessagesService({
        db: {
          select: () => makeSelectDb([fakeParent]),
          // biome-ignore lint/suspicious/useAwait: contract requires async signature
          transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
            const fakeTx = {
              select: () => makeSelectDb([fakeParent]),
              insert: (_table: unknown) => ({
                values: (vals: Record<string, unknown>) => {
                  if ('kind' in vals) {
                    capturedKind = vals.kind
                    capturedRole = vals.role
                    capturedContent = vals.content
                    capturedParentId = vals.parentMessageId
                    return { returning: async () => [fakeReplyRow] }
                  }
                  return { returning: async () => [{ id: 999 }] }
                },
              }),
            }
            return fn(fakeTx)
          },
        },
      }),
    )

    await appendCardReplyMessage({
      parentMessageId: 'parent-card-1',
      buttonId: 'btn-confirm',
      buttonValue: 'confirm',
    })

    expect(capturedKind).toBe('card_reply')
    expect(capturedRole).toBe('customer')
    expect(capturedParentId).toBe('parent-card-1')
    expect((capturedContent as Record<string, unknown>)?.buttonId).toBe('btn-confirm')
  })

  it('throws when parent message not found', async () => {
    installMessagesService(
      createMessagesService({
        db: {
          select: () => makeSelectDb([]),
          transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ select: () => makeSelectDb([]) } as unknown),
        },
      }),
    )

    await expect(
      appendCardReplyMessage({ parentMessageId: 'missing-id', buttonId: 'b', buttonValue: 'v' }),
    ).rejects.toThrow('not found')
  })
})

// ─── hasRecentAgentReply ──────────────────────────────────────────────────────

function makeRecentAgentReplyDb(rows: unknown[]) {
  return {
    select: () => makeSelectDb(rows),
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const fakeTx = {
        insert: makeTxInsert({}),
        select: () => makeSelectDb(rows),
      }
      return fn(fakeTx)
    },
  }
}

function makeAgentTextRow(secondsAgo: number): Message {
  return {
    id: `msg-${secondsAgo}s`,
    conversationId: 'conv-1',
    organizationId: 'org-1',
    role: 'agent',
    kind: 'text',
    content: { text: 'hello' },
    parentMessageId: null,
    channelExternalId: null,
    status: null,
    attachments: [],
    metadata: {},
    createdAt: new Date(Date.now() - secondsAgo * 1000),
  }
}

describe('hasRecentAgentReply', () => {
  it('returns false when there are no messages', async () => {
    installMessagesService(createMessagesService({ db: makeRecentAgentReplyDb([]) }))
    core.setJournalDb(makeJournalDb())
    const result = await hasRecentAgentReply('conv-1', 60)
    expect(result).toBe(false)
  })

  it('returns false when the DB returns no matching rows (e.g. only customer messages in window)', async () => {
    // The WHERE clause (role='agent' AND kind IN ...) is enforced by Postgres;
    // the stub simulates the DB returning zero rows after that filter.
    installMessagesService(createMessagesService({ db: makeRecentAgentReplyDb([]) }))
    core.setJournalDb(makeJournalDb())
    const result = await hasRecentAgentReply('conv-1', 60)
    expect(result).toBe(false)
  })

  it('returns true when a recent agent text message exists', async () => {
    const msg = makeAgentTextRow(5) // 5 seconds ago, within 60s window
    installMessagesService(createMessagesService({ db: makeRecentAgentReplyDb([msg]) }))
    core.setJournalDb(makeJournalDb())
    const result = await hasRecentAgentReply('conv-1', 60)
    expect(result).toBe(true)
  })

  it('returns true when a recent agent card message exists', async () => {
    const msg: Message = { ...makeAgentTextRow(5), kind: 'card', content: { card: {} } }
    installMessagesService(createMessagesService({ db: makeRecentAgentReplyDb([msg]) }))
    core.setJournalDb(makeJournalDb())
    const result = await hasRecentAgentReply('conv-1', 60)
    expect(result).toBe(true)
  })

  it('returns false when the agent text message is older than the window (simulated by DB returning no rows)', async () => {
    // The gt(messages.createdAt, cutoff) predicate is evaluated by Postgres;
    // the stub simulates that filter having excluded the old message.
    const oldMsg = makeAgentTextRow(90) // 90s ago — outside the 60s window
    // Stub returns zero rows, as real Postgres would after applying the cutoff.
    const db = makeRecentAgentReplyDb([])
    // Confirm the message itself exists but the stub represents DB-level filtering:
    expect(oldMsg.createdAt.getTime()).toBeLessThan(Date.now() - 60 * 1000)
    installMessagesService(createMessagesService({ db }))
    core.setJournalDb(makeJournalDb())
    const result = await hasRecentAgentReply('conv-1', 60)
    expect(result).toBe(false)
  })
})

/**
 * messages.ts unit tests — verifies appendCardReplyMessage atomic write path.
 * Stubs the DB to avoid a real Postgres connection.
 */
import { beforeEach, describe, expect, it } from 'bun:test'

import type { Message } from '../schema'

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

beforeEach(async () => {
  const mod = await import('./messages')
  mod.installMessagesService(mod.createMessagesService({ db: makeDb([fakeParent], fakeReplyRow) }))

  const core = await import('@vobase/core')
  core.setJournalDb(makeJournalDb())
})

describe('appendCardReplyMessage', () => {
  it('returns Message with kind card_reply', async () => {
    const { appendCardReplyMessage } = await import('./messages')

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
    const { appendCardReplyMessage, createMessagesService, installMessagesService } = await import('./messages')

    let capturedKind: unknown
    let capturedRole: unknown
    let capturedContent: unknown
    let capturedParentId: unknown

    installMessagesService(
      createMessagesService({
        db: {
          select: () => makeSelectDb([fakeParent]),
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
    const { appendCardReplyMessage, createMessagesService, installMessagesService } = await import('./messages')

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

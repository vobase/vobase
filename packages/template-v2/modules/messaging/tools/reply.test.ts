import { beforeEach, describe, expect, it } from 'bun:test'
import { createMessagesService, installMessagesService } from '@modules/messaging/service/messages'
import type { ToolContext } from '@vobase/core'
import { setJournalDb } from '@vobase/core'

import { replyTool } from './reply'

type Row = Record<string, unknown>

let messageStore: Row[] = []
let eventStore: Row[] = []

function makeDb() {
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      let insertIdx = 0
      const tx = {
        insert: (_table: unknown) => {
          const idx = ++insertIdx
          return {
            values: (v: unknown) => {
              if (idx === 1) {
                const row = { id: 'msg-test-1', ...(v as Row) }
                messageStore.push(row)
                return { returning: async () => [row] }
              }
              eventStore.push(v as Row)
              return Promise.resolve()
            },
          }
        },
      }
      return fn(tx)
    },
  }
}

const noopJournalDb = { insert: (_: unknown) => ({ values: (_v: unknown) => Promise.resolve() }) }

beforeEach(() => {
  messageStore = []
  eventStore = []
  installMessagesService(createMessagesService({ db: makeDb() }))
  setJournalDb(noopJournalDb)
})

function makeCtx(): ToolContext {
  return {
    organizationId: 'org-1',
    conversationId: 'conv-1',
    wakeId: 'wake-1',
    agentId: 'agt-1',
    turnIndex: 0,
    toolCallId: 'tc-1',
  }
}

describe('replyTool', () => {
  it('has stable name and no requiresApproval gate', () => {
    expect(replyTool.name).toBe('reply')
    expect(replyTool.requiresApproval).toBeFalsy()
  })

  it('rejects empty text', async () => {
    const result = await replyTool.execute({ text: '' }, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('rejects missing text field', async () => {
    const result = await replyTool.execute({} as { text: string }, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('happy path returns messageId and writes message + event in one tx', async () => {
    const result = await replyTool.execute({ text: 'hello customer' }, makeCtx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.messageId).toBe('msg-test-1')
    expect(messageStore).toHaveLength(1)
    expect(eventStore).toHaveLength(1)
    expect(messageStore[0]?.kind).toBe('text')
  })

  it('accepts optional replyToMessageId', async () => {
    const result = await replyTool.execute({ text: 'hi', replyToMessageId: 'msg-prev' }, makeCtx())
    expect(result.ok).toBe(true)
  })
})

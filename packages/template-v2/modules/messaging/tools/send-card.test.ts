import { beforeEach, describe, expect, it } from 'bun:test'
import { createMessagesService, installMessagesService } from '@modules/messaging/service/messages'
import type { ToolContext } from '@vobase/core'
import { setJournalDb } from '@vobase/core'
import { sendCardTool } from './send-card'

type Row = Record<string, unknown>

let messageStore: Row[] = []
let eventStore: Row[] = []

function makeDb() {
  return {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      let insertIdx = 0
      const tx = {
        insert: (_table: unknown) => {
          const idx = ++insertIdx
          return {
            values: (v: unknown) => {
              if (idx === 1) {
                const row = { id: 'msg-card-1', ...(v as Row) }
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

const validCard = {
  type: 'card' as const,
  title: 'Refund Policy',
  children: [{ type: 'text' as const, content: 'We offer 30-day refunds.' }],
}

describe('sendCardTool', () => {
  it('has stable name and requiresApproval=true', () => {
    expect(sendCardTool.name).toBe('send_card')
    expect(sendCardTool.requiresApproval).toBe(true)
  })

  it('rejects card with empty children array', async () => {
    const result = await sendCardTool.execute({ type: 'card', children: [] }, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('rejects missing type field', async () => {
    const result = await sendCardTool.execute({ children: [{ type: 'text', content: 'x' }] } as never, makeCtx())
    expect(result.ok).toBe(false)
  })

  it('rejects unknown child type', async () => {
    const result = await sendCardTool.execute({ type: 'card', children: [{ type: 'unknown' }] } as never, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('happy path returns messageId and writes card message + event in one tx', async () => {
    const result = await sendCardTool.execute(validCard, makeCtx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.messageId).toBe('msg-card-1')
    expect(messageStore).toHaveLength(1)
    expect(eventStore).toHaveLength(1)
    expect(messageStore[0]?.kind).toBe('card')
  })

  it('approval gate: tool declares requiresApproval=true (approvalMutator blocks in approval.test.ts)', () => {
    expect(sendCardTool.requiresApproval).toBe(true)
  })
})

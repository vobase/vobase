import { beforeEach, describe, expect, it } from 'bun:test'
import { createMessagesService, installMessagesService } from '@modules/messaging/service/messages'
import type { ToolContext } from '@vobase/core'
import { setJournalDb } from '@vobase/core'

import { sendFileTool } from './send-file'

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
                const row = { id: 'msg-file-1', ...(v as Row) }
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

describe('sendFileTool', () => {
  it('has stable name and requiresApproval=true', () => {
    expect(sendFileTool.name).toBe('send_file')
    expect(sendFileTool.requiresApproval).toBe(true)
  })

  it('rejects empty driveFileId', async () => {
    const result = await sendFileTool.execute({ driveFileId: '' }, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('rejects missing driveFileId', async () => {
    const result = await sendFileTool.execute({} as { driveFileId: string }, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('happy path returns messageId and writes media message + event in one tx', async () => {
    const result = await sendFileTool.execute({ driveFileId: 'file-abc' }, makeCtx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.messageId).toBe('msg-file-1')
    expect(messageStore).toHaveLength(1)
    expect(eventStore).toHaveLength(1)
  })

  it('accepts optional caption', async () => {
    const result = await sendFileTool.execute({ driveFileId: 'file-abc', caption: 'See attached' }, makeCtx())
    expect(result.ok).toBe(true)
  })

  it('threat-scan stub always passes (Phase 2)', async () => {
    const result = await sendFileTool.execute({ driveFileId: 'any-file' }, makeCtx())
    expect(result.ok).toBe(true)
  })
})

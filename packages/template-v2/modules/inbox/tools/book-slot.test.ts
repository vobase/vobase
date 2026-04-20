import { describe, expect, it } from 'bun:test'
import type { ToolContext } from '@server/contracts/tool'
import { bookSlotTool } from './book-slot'

function makeCtx(): ToolContext {
  return {
    organizationId: 'ten-1',
    conversationId: 'conv-1',
    wakeId: 'wake-1',
    agentId: 'agt-1',
    turnIndex: 0,
    toolCallId: 'tc-1',
  }
}

describe('bookSlotTool', () => {
  it('has stable name and requiresApproval=true', () => {
    expect(bookSlotTool.name).toBe('book_slot')
    expect(bookSlotTool.requiresApproval).toBe(true)
  })

  it('rejects empty slotId', async () => {
    const result = await bookSlotTool.execute({ slotId: '', contactId: 'c-1' }, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('rejects missing contactId', async () => {
    const result = await bookSlotTool.execute({ slotId: 'slot-1' } as never, makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('happy path returns slotId and confirmed=true (Phase 2 stub)', async () => {
    const result = await bookSlotTool.execute({ slotId: 'slot-abc', contactId: 'contact-1' }, makeCtx())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.slotId).toBe('slot-abc')
      expect(result.content.confirmed).toBe(true)
    }
  })

  it('accepts optional notes', async () => {
    const result = await bookSlotTool.execute({ slotId: 'slot-1', contactId: 'c-1', notes: 'call first' }, makeCtx())
    expect(result.ok).toBe(true)
  })
})

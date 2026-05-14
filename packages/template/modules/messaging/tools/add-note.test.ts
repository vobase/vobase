import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { __resetNotesServiceForTests, installNotesService, type NotesService } from '@modules/messaging/service/notes'
import type { ToolContext } from '@vobase/core'

import { addNoteTool } from './add-note'

const ORG_ID = 'org0test0'
const AGENT_ID = 'agt0op0001'

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: ORG_ID,
    conversationId: 'conv1',
    wakeId: 'wake1',
    agentId: AGENT_ID,
    turnIndex: 0,
    toolCallId: 'call1',
    ...overrides,
  }
}

afterAll(() => {
  __resetNotesServiceForTests()
})

describe('addNoteTool', () => {
  beforeEach(() => {
    __resetNotesServiceForTests()
  })

  it('writes an undirected breadcrumb as the agent — no recipient', async () => {
    let received: unknown = null
    installNotesService({
      addNote: (input) => {
        received = input
        return Promise.resolve({ id: 'note1' } as never)
      },
      listNotes: () => Promise.resolve([]),
    } as NotesService)
    const result = await addNoteTool.execute({ conversationId: 'conv1', body: 'looked into refund policy' }, ctx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.noteId).toBe('note1')
    expect(received).toEqual({
      organizationId: ORG_ID,
      conversationId: 'conv1',
      author: { kind: 'agent', id: AGENT_ID },
      body: 'looked into refund policy',
    })
  })

  it('defaults conversationId to the wake context when omitted', async () => {
    let received: { conversationId?: string } = {}
    installNotesService({
      addNote: (input) => {
        received = input
        return Promise.resolve({ id: 'note2' } as never)
      },
      listNotes: () => Promise.resolve([]),
    } as NotesService)
    await addNoteTool.execute({ body: 'breadcrumb' }, ctx({ conversationId: 'wake-conv' }))
    expect(received.conversationId).toBe('wake-conv')
  })
})

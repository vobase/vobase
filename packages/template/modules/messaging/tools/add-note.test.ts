import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { __resetNotesServiceForTests, installNotesService, type NotesService } from '@modules/messaging/service/notes'
import type { StaffProfile } from '@modules/team/schema'
import { __resetStaffServiceForTests, installStaffService, type StaffService } from '@modules/team/service/staff'
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

function installStaffStub(roster: ReadonlyArray<{ userId: string; displayName?: string }>): void {
  const profiles = roster.map((r) => ({ userId: r.userId, displayName: r.displayName ?? null }) as StaffProfile)
  installStaffService({
    list: () => Promise.resolve(profiles),
    get: () => Promise.reject(new Error('not used')),
    find: () => Promise.resolve(null),
  } as unknown as StaffService)
}

afterAll(() => {
  __resetNotesServiceForTests()
  __resetStaffServiceForTests()
})

describe('addNoteTool', () => {
  beforeEach(() => {
    __resetNotesServiceForTests()
    __resetStaffServiceForTests()
  })

  it('writes the note as the agent', async () => {
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
      mentions: [],
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

  it('resolves mentions to staff:<userId> and prepends @DisplayName', async () => {
    installStaffStub([{ userId: 'u1', displayName: 'Alice' }])
    let received: { mentions?: string[]; body?: string } = {}
    installNotesService({
      addNote: (input) => {
        received = input
        return Promise.resolve({ id: 'n2' } as never)
      },
      listNotes: () => Promise.resolve([]),
    } as NotesService)
    await addNoteTool.execute({ conversationId: 'c', body: 'fyi', mentions: ['user:u1'] }, ctx())
    expect(received.mentions).toEqual(['staff:u1'])
    expect(received.body).toBe('@Alice fyi')
  })

  it('returns an error result when a mentioned token cannot be resolved', async () => {
    installStaffStub([{ userId: 'u1', displayName: 'Alice' }])
    installNotesService({
      addNote: () => Promise.reject(new Error('should not be called')),
      listNotes: () => Promise.resolve([]),
    } as NotesService)
    const result = await addNoteTool.execute({ conversationId: 'c', body: 'fyi', mentions: ['ghost'] }, ctx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/unknown staff/i)
  })

  it('dedups when the same staff is referenced by id and displayName', async () => {
    installStaffStub([{ userId: 'u1', displayName: 'Alice' }])
    let received: { mentions?: string[]; body?: string } = {}
    installNotesService({
      addNote: (input) => {
        received = input
        return Promise.resolve({ id: 'n3' } as never)
      },
      listNotes: () => Promise.resolve([]),
    } as NotesService)
    await addNoteTool.execute({ conversationId: 'c', body: 'fyi', mentions: ['user:u1', 'Alice'] }, ctx())
    expect(received.mentions).toEqual(['staff:u1'])
    expect(received.body).toBe('@Alice fyi')
  })
})

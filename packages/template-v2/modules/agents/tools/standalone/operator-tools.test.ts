/**
 * Unit tests for the operator tool set.
 *
 * Stubs the underlying services (contacts, notes, schedules, conversations,
 * pending-approvals) via the install* hooks so each tool's wrapper logic —
 * input validation, ctx-derived fields (organizationId, agentId), output
 * shape — is verified in isolation.
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetContactsServiceForTests,
  type ContactsService,
  installContactsService,
} from '@modules/contacts/service/contacts'
import {
  __resetConversationsServiceForTests,
  type ConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import { __resetNotesServiceForTests, installNotesService, type NotesService } from '@modules/messaging/service/notes'
import {
  __resetPendingApprovalsServiceForTests,
  installPendingApprovalsService,
  type PendingApprovalsService,
} from '@modules/messaging/service/pending-approvals'
import {
  __resetSchedulesServiceForTests,
  installSchedulesService,
  type SchedulesService,
} from '@modules/schedules/service/schedules'
import type { ToolContext } from '@vobase/core'

import { addNoteTool } from './add-note'
import { createScheduleTool } from './create-schedule'
import { draftEmailToReviewTool } from './draft-email-to-review'
import { pauseScheduleTool } from './pause-schedule'
import { proposeOutreachTool } from './propose-outreach'
import { summarizeInboxTool } from './summarize-inbox'
import { updateContactTool } from './update-contact'

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
  __resetContactsServiceForTests()
  __resetNotesServiceForTests()
  __resetSchedulesServiceForTests()
  __resetConversationsServiceForTests()
  __resetPendingApprovalsServiceForTests()
})

describe('updateContactTool', () => {
  it('rejects empty contactId', async () => {
    installContactsService({} as ContactsService)
    const result = await updateContactTool.execute({ contactId: '', patch: {} } as never, ctx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('forwards patch to contacts.update and returns the id', async () => {
    let receivedPatch: unknown = null
    installContactsService({
      update: (id: string, patch: unknown) => {
        receivedPatch = patch
        return Promise.resolve({ id, displayName: 'New', phone: null, email: null } as never)
      },
    } as unknown as ContactsService)
    const result = await updateContactTool.execute(
      { contactId: 'cont1', patch: { displayName: 'New', segments: ['vip'] } },
      ctx(),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.id).toBe('cont1')
    expect(receivedPatch).toEqual({ displayName: 'New', segments: ['vip'] })
  })

  it('returns UPDATE_ERROR on service rejection', async () => {
    installContactsService({
      update: () => Promise.reject(new Error('db down')),
    } as unknown as ContactsService)
    const result = await updateContactTool.execute({ contactId: 'cont1', patch: {} }, ctx())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('UPDATE_ERROR')
      expect(result.error).toContain('db down')
    }
  })
})

describe('addNoteTool', () => {
  beforeEach(() => __resetNotesServiceForTests())

  it('writes the note as the operator agent', async () => {
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

  it('forwards mentions array unchanged', async () => {
    let received: { mentions?: string[] } = {}
    installNotesService({
      addNote: (input) => {
        received = input
        return Promise.resolve({ id: 'n2' } as never)
      },
      listNotes: () => Promise.resolve([]),
    } as NotesService)
    await addNoteTool.execute({ conversationId: 'c', body: '@u1 fyi', mentions: ['user:u1'] }, ctx())
    expect(received.mentions).toEqual(['user:u1'])
  })
})

describe('createScheduleTool', () => {
  beforeEach(() => __resetSchedulesServiceForTests())

  it('rejects malformed slug', async () => {
    installSchedulesService({} as SchedulesService)
    const result = await createScheduleTool.execute({ slug: 'Invalid Slug', cron: '0 18 * * *' } as never, ctx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('defaults agentId to ctx.agentId when omitted', async () => {
    let received: unknown = null
    installSchedulesService({
      create: (input) => {
        received = input
        return Promise.resolve({ scheduleId: 'sch1' })
      },
      setEnabled: () => Promise.resolve(),
      recordTick: () => Promise.resolve({ idempotencyKey: '', firstFire: false }),
      listEnabled: () => Promise.resolve([]),
      listAll: () => Promise.resolve([]),
      getById: () => Promise.resolve(undefined),
      listAllEnabled: () => Promise.resolve([]),
    })
    const result = await createScheduleTool.execute({ slug: 'daily-brief', cron: '0 18 * * *' }, ctx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.scheduleId).toBe('sch1')
    expect((received as { agentId: string }).agentId).toBe(AGENT_ID)
  })

  it('honours explicit agentId override', async () => {
    let received: unknown = null
    installSchedulesService({
      create: (input) => {
        received = input
        return Promise.resolve({ scheduleId: 'sch2' })
      },
      setEnabled: () => Promise.resolve(),
      recordTick: () => Promise.resolve({ idempotencyKey: '', firstFire: false }),
      listEnabled: () => Promise.resolve([]),
      listAll: () => Promise.resolve([]),
      getById: () => Promise.resolve(undefined),
      listAllEnabled: () => Promise.resolve([]),
    })
    await createScheduleTool.execute({ slug: 'other', cron: '0 8 * * *', agentId: 'agt0other' }, ctx())
    expect((received as { agentId: string }).agentId).toBe('agt0other')
  })
})

describe('pauseScheduleTool', () => {
  beforeEach(() => __resetSchedulesServiceForTests())

  it('defaults enabled to false (pause)', async () => {
    let received: unknown = null
    installSchedulesService({
      create: () => Promise.resolve({ scheduleId: '' }),
      setEnabled: (input) => {
        received = input
        return Promise.resolve()
      },
      recordTick: () => Promise.resolve({ idempotencyKey: '', firstFire: false }),
      listEnabled: () => Promise.resolve([]),
      listAll: () => Promise.resolve([]),
      getById: () => Promise.resolve(undefined),
      listAllEnabled: () => Promise.resolve([]),
    })
    const result = await pauseScheduleTool.execute({ scheduleId: 'sch1' }, ctx())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toEqual({ scheduleId: 'sch1', enabled: false })
    expect(received).toEqual({ scheduleId: 'sch1', enabled: false })
  })

  it('passes through enabled=true to resume', async () => {
    let received: unknown = null
    installSchedulesService({
      create: () => Promise.resolve({ scheduleId: '' }),
      setEnabled: (input) => {
        received = input
        return Promise.resolve()
      },
      recordTick: () => Promise.resolve({ idempotencyKey: '', firstFire: false }),
      listEnabled: () => Promise.resolve([]),
      listAll: () => Promise.resolve([]),
      getById: () => Promise.resolve(undefined),
      listAllEnabled: () => Promise.resolve([]),
    })
    await pauseScheduleTool.execute({ scheduleId: 'sch2', enabled: true }, ctx())
    expect((received as { enabled: boolean }).enabled).toBe(true)
  })
})

describe('summarizeInboxTool', () => {
  beforeEach(() => __resetConversationsServiceForTests())

  it('honours limit and shapes rows correctly', async () => {
    const lastMsg = new Date('2026-04-26T10:00:00Z')
    installConversationsService({
      list: () =>
        Promise.resolve(
          Array.from({ length: 70 }, (_, i) => ({
            id: `c${i}`,
            contactId: `cont${i}`,
            channelInstanceId: 'ch1',
            assignee: 'unassigned',
            status: 'active',
            lastMessageAt: lastMsg,
          })) as never,
        ),
    } as unknown as ConversationsService)
    const result = await summarizeInboxTool.execute({ limit: 5 }, ctx())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.total).toBe(70)
      expect(result.content.rows).toHaveLength(5)
      expect(result.content.rows[0]).toEqual({
        conversationId: 'c0',
        contactId: 'cont0',
        channelInstanceId: 'ch1',
        assignee: 'unassigned',
        status: 'active',
        lastMessageAt: '2026-04-26T10:00:00.000Z',
      })
    }
  })

  it('forwards tab + owner to the conversations service', async () => {
    let received: unknown = null
    installConversationsService({
      list: (orgId: string, opts: unknown) => {
        received = { orgId, opts }
        return Promise.resolve([])
      },
    } as unknown as ConversationsService)
    await summarizeInboxTool.execute({ tab: 'later', owner: 'mine' }, ctx())
    expect(received).toEqual({ orgId: ORG_ID, opts: { tab: 'later', owner: 'mine' } })
  })
})

describe('draftEmailToReviewTool', () => {
  beforeEach(() => __resetPendingApprovalsServiceForTests())

  it('queues with toolName=draft_email_to_review and snapshot from ctx', async () => {
    let received: unknown = null
    installPendingApprovalsService({
      insert: (input: unknown) => {
        received = input
        return Promise.resolve({ id: 'app1' } as never)
      },
      get: () => Promise.resolve(null as never),
      list: () => Promise.resolve([]),
      decide: () => Promise.resolve({} as never),
      persistRejectionNote: () => Promise.resolve(),
    } as unknown as PendingApprovalsService)
    const result = await draftEmailToReviewTool.execute(
      { conversationId: 'conv1', subject: 'Refund follow-up', body: 'Hi…' },
      ctx({ wakeId: 'wakeABC', turnIndex: 3 }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.approvalId).toBe('app1')
    expect((received as { toolName: string }).toolName).toBe('draft_email_to_review')
    expect((received as { agentSnapshot: { wakeId: string } }).agentSnapshot.wakeId).toBe('wakeABC')
    expect((received as { agentSnapshot: { turnIndex: number } }).agentSnapshot.turnIndex).toBe(3)
  })
})

describe('proposeOutreachTool', () => {
  beforeEach(() => __resetPendingApprovalsServiceForTests())

  it('queues with toolName=propose_outreach and outreach:pending sentinel', async () => {
    let received: unknown = null
    installPendingApprovalsService({
      insert: (input: unknown) => {
        received = input
        return Promise.resolve({ id: 'app2' } as never)
      },
      get: () => Promise.resolve(null as never),
      list: () => Promise.resolve([]),
      decide: () => Promise.resolve({} as never),
      persistRejectionNote: () => Promise.resolve(),
    } as unknown as PendingApprovalsService)
    const result = await proposeOutreachTool.execute(
      { contactId: 'cont1', channelInstanceId: 'ch-wa', body: 'Are you still interested?' },
      ctx(),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.approvalId).toBe('app2')
    expect((received as { toolName: string }).toolName).toBe('propose_outreach')
    expect((received as { conversationId: string | null }).conversationId).toBeNull()
  })

  it('rejects empty body', async () => {
    installPendingApprovalsService({} as PendingApprovalsService)
    const result = await proposeOutreachTool.execute(
      { contactId: 'cont1', channelInstanceId: 'ch-wa', body: '' } as never,
      ctx(),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })
})

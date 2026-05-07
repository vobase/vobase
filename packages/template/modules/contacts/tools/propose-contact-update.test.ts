/**
 * Unit tests for propose_contact_update — exercises the diff/route logic
 * by stubbing the three services it depends on (conversations.get,
 * contacts.get, changes.insertProposal). Uses `mock.module` for the changes
 * service because `wake/observers/workspace-sync.test.ts` and
 * `wake/observers/learning-proposals.test.ts` already mock that module
 * process-wide; an `installChangeProposalsService` stub would be silently
 * overridden by their `mock.module` replacement.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

const lastInsert: { value: Record<string, unknown> | null } = { value: null }
const insertImpl: { fn: (input: Record<string, unknown>) => Promise<{ id: string; status: string }> } = {
  fn: () => Promise.resolve({ id: 'p_default', status: 'pending' }),
}

mock.module('@modules/changes/service/proposals', () => ({
  insertProposal: (input: Record<string, unknown>) => {
    lastInsert.value = input
    return insertImpl.fn(input)
  },
}))

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
import type { ToolContext } from '@vobase/core'

import { proposeContactUpdateTool } from './propose-contact-update'

const ORG_ID = 'org0test0'
const AGENT_ID = 'agt0meri0v1'
const CONV_ID = 'cv0test01'
const CONTACT_ID = 'cnt0test1'

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: ORG_ID,
    conversationId: CONV_ID,
    wakeId: 'wk1',
    agentId: AGENT_ID,
    turnIndex: 0,
    toolCallId: 'tc1',
    ...overrides,
  }
}

interface ContactPatch {
  displayName?: string | null
  email?: string | null
  phone?: string | null
  segments?: string[] | null
  marketingOptOut?: boolean
  attributes?: Record<string, unknown>
}

function installContact(contact: ContactPatch): void {
  installContactsService({
    get: (id: string) =>
      Promise.resolve({
        id,
        organizationId: ORG_ID,
        displayName: null,
        email: null,
        phone: null,
        segments: [],
        marketingOptOut: false,
        attributes: {},
        ...contact,
      } as never),
  } as unknown as ContactsService)
}

beforeEach(() => {
  lastInsert.value = null
  insertImpl.fn = () => Promise.resolve({ id: 'p_default', status: 'pending' })
  installConversationsService({
    get: (id: string) => Promise.resolve({ id, contactId: CONTACT_ID, organizationId: ORG_ID } as never),
  } as unknown as ConversationsService)
})

afterEach(() => {
  __resetConversationsServiceForTests()
  __resetContactsServiceForTests()
})

afterAll(() => {
  __resetConversationsServiceForTests()
  __resetContactsServiceForTests()
})

describe('proposeContactUpdateTool', () => {
  it('rejects an empty rationale', async () => {
    installContact({})
    const result = await proposeContactUpdateTool.execute(
      { patch: { email: 'a@b.com' }, rationale: '' } as never,
      ctx(),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('returns no_op when proposed values match the current row', async () => {
    installContact({ email: 'same@example.com' })
    const result = await proposeContactUpdateTool.execute(
      { patch: { email: 'same@example.com' }, rationale: 'customer asked' },
      ctx(),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.status).toBe('no_op')
      expect(result.content.proposalId).toBeNull()
      expect(result.content.fieldsTouched).toEqual([])
    }
    expect(lastInsert.value).toBeNull()
  })

  it('routes a gated email change to insertProposal and surfaces pending status', async () => {
    installContact({ email: 'old@example.com', displayName: 'Marc Chen' })
    insertImpl.fn = () => Promise.resolve({ id: 'p1', status: 'pending' })
    const result = await proposeContactUpdateTool.execute(
      { patch: { email: 'new@example.com' }, rationale: 'Customer asked to update email; old one bouncing.' },
      ctx(),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.proposalId).toBe('p1')
      expect(result.content.status).toBe('pending')
      expect(result.content.fieldsTouched).toEqual(['email'])
      expect(result.content.replyHint).toContain('logged for our team to review')
    }
    expect(lastInsert.value?.payload).toEqual({
      kind: 'field_set',
      fields: { email: { from: 'old@example.com', to: 'new@example.com' } },
    })
    expect(lastInsert.value?.conversationId).toBe(CONV_ID)
    expect(lastInsert.value?.changedBy).toBe(`agent:${AGENT_ID}`)
    expect(lastInsert.value?.rationale).toBe('Customer asked to update email; old one bouncing.')
  })

  it('routes a non-gated phone change as auto_written', async () => {
    installContact({ phone: null })
    insertImpl.fn = () => Promise.resolve({ id: 'p2', status: 'auto_written' })
    const result = await proposeContactUpdateTool.execute(
      { patch: { phone: '+1-555-0199' }, rationale: 'Customer says old number is no longer in service.' },
      ctx(),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.status).toBe('auto_written')
      expect(result.content.fieldsTouched).toEqual(['phone'])
      expect(result.content.replyHint).toContain('done')
    }
  })

  it('flattens patch.attributes into namespaced field_set keys', async () => {
    installContact({ attributes: { industry: 'logistics' } })
    insertImpl.fn = () => Promise.resolve({ id: 'p3', status: 'auto_written' })
    const result = await proposeContactUpdateTool.execute(
      {
        patch: { attributes: { industry: 'logistics', renewal_date: '2026-09-01' } },
        rationale: 'Customer mentioned renewal in September.',
      },
      ctx(),
    )
    expect(result.ok).toBe(true)
    expect(lastInsert.value?.payload).toEqual({
      kind: 'field_set',
      fields: { 'attributes.renewal_date': { from: null, to: '2026-09-01' } },
    })
  })

  it('returns pending without re-throwing on duplicate-pending conflict', async () => {
    installContact({ email: 'old@example.com' })
    insertImpl.fn = () =>
      Promise.reject(
        new Error('change-proposals: contacts/contact/cnt0test1 already has a pending proposal (id=existing01)'),
      )
    const result = await proposeContactUpdateTool.execute(
      { patch: { email: 'new@example.com' }, rationale: 'Customer asked again.' },
      ctx(),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.status).toBe('pending')
      expect(result.content.proposalId).toBeNull()
      expect(result.content.replyHint).toContain('already pending')
    }
  })

  it('bubbles non-conflict errors with PROPOSE_CONTACT_UPDATE_ERROR', async () => {
    installContact({ email: 'old@example.com' })
    insertImpl.fn = () => Promise.reject(new Error('db down'))
    const result = await proposeContactUpdateTool.execute(
      { patch: { email: 'new@example.com' }, rationale: 'customer asked' },
      ctx(),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('PROPOSE_CONTACT_UPDATE_ERROR')
      expect(result.error).toContain('db down')
    }
  })
})

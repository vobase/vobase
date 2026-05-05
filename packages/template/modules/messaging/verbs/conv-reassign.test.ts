/**
 * conv-reassign verb unit tests.
 *
 * Stubs all service dependencies so no real Postgres connection is needed.
 * Covers the customer-ack precondition (agent → user handoff requires a recent
 * agent-authored customer-facing message), staff bypass, unassigned bypass, and
 * agent-target bypass.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetConversationsServiceForTests,
  type ConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import {
  __resetMessagesServiceForTests,
  installMessagesService,
  type MessagesService,
} from '@modules/messaging/service/messages'
import type { StaffProfile } from '@modules/team/schema'
import { __resetStaffServiceForTests, installStaffService, type StaffService } from '@modules/team/service/staff'
import type { VerbContext } from '@vobase/core'

import { convReassignVerb } from './conv-reassign'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAgentCtx(overrides: Partial<VerbContext> = {}): VerbContext {
  return {
    organizationId: 'org-test',
    principal: { kind: 'agent', id: 'agt-001' },
    wake: {
      conversationId: 'conv-test',
      contactId: 'contact-001',
      wakeId: 'wake-001',
      turnIndex: 0,
    },
    ...overrides,
  }
}

function makeUserCtx(overrides: Partial<VerbContext> = {}): VerbContext {
  return {
    organizationId: 'org-test',
    principal: { kind: 'user', id: 'usr-staff-1' },
    wake: {
      conversationId: 'conv-test',
      contactId: 'contact-001',
      wakeId: 'wake-001',
      turnIndex: 0,
    },
    ...overrides,
  }
}

const ALICE: StaffProfile = { userId: 'usr0alice0', displayName: 'Alice' } as StaffProfile

function installStaffStub(roster: StaffProfile[] = [ALICE]): void {
  installStaffService({
    list: () => Promise.resolve(roster),
    get: () => Promise.reject(new Error('not used')),
    find: () => Promise.resolve(null),
  } as unknown as StaffService)
}

function installMessagesStub(hasRecent: boolean): void {
  installMessagesService({
    appendTextMessage: () => Promise.reject(new Error('not used')),
    appendCardMessage: () => Promise.reject(new Error('not used')),
    appendMediaMessage: () => Promise.reject(new Error('not used')),
    appendStaffTextMessage: () => Promise.reject(new Error('not used')),
    appendCardReplyMessage: () => Promise.reject(new Error('not used')),
    list: () => Promise.resolve([]),
    updateDeliveryStatus: () => Promise.resolve(),
    hasRecentAgentReply: () => Promise.resolve(hasRecent),
  } as MessagesService)
}

function makeConvRow(assignee: string) {
  return { id: 'conv-test', assignee, status: 'active', organizationId: 'org-test' }
}

function installConvStub(_assignee: string): void {
  installConversationsService({
    reassign: (_convId: string, a: string) => Promise.resolve(makeConvRow(a) as never),
  } as unknown as ConversationsService)
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

afterAll(() => {
  __resetMessagesServiceForTests()
  __resetConversationsServiceForTests()
  __resetStaffServiceForTests()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('convReassignVerb', () => {
  beforeEach(() => {
    __resetMessagesServiceForTests()
    __resetConversationsServiceForTests()
    __resetStaffServiceForTests()
  })

  describe('happy path — agent → user with recent ack', () => {
    it('succeeds when a recent agent text message exists', async () => {
      installStaffStub()
      installMessagesStub(true)
      installConvStub(`user:${ALICE.userId}`)

      const result = await convReassignVerb.body({
        input: { to: `user:${ALICE.userId}` },
        ctx: makeAgentCtx(),
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.assignee).toBe(`user:${ALICE.userId}`)
      }
    })
  })

  describe('block path — agent → user without recent ack', () => {
    it('returns no_customer_ack when no recent agent message', async () => {
      installStaffStub()
      installMessagesStub(false)

      const result = await convReassignVerb.body({
        input: { to: `user:${ALICE.userId}` },
        ctx: makeAgentCtx(),
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('no_customer_ack')
        expect(result.error).toMatch(/reply/i)
        expect(result.error).toMatch(/send_card/i)
      }
    })
  })

  describe('staff bypass — user principal skips ack check', () => {
    it('does not enforce ack when principal is user', async () => {
      installStaffStub()
      // no recent agent reply — but staff should bypass
      installMessagesStub(false)
      installConvStub(`user:${ALICE.userId}`)

      const result = await convReassignVerb.body({
        input: { to: `user:${ALICE.userId}` },
        ctx: makeUserCtx(),
      })

      expect(result.ok).toBe(true)
    })
  })

  describe('unassigned target — no ack check', () => {
    it('does not enforce ack when reassigning to unassigned', async () => {
      // No messages service stub needed — check should not fire
      installMessagesStub(false)
      installConvStub('unassigned')

      const result = await convReassignVerb.body({
        input: { to: 'unassigned' },
        ctx: makeAgentCtx(),
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.assignee).toBe('unassigned')
      }
    })
  })

  describe('agent: target — no ack check', () => {
    it('does not enforce ack when reassigning to another agent', async () => {
      installMessagesStub(false)
      installConvStub('agent:agt-002')

      const result = await convReassignVerb.body({
        input: { to: 'agent:agt-002' },
        ctx: makeAgentCtx(),
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.assignee).toBe('agent:agt-002')
      }
    })
  })
})

/**
 * conv-set-owner verb unit tests.
 *
 * Stubs the conversations + staff singletons so no Postgres is needed. Covers the
 * happy path, the out-of-wake --conversationId fallback, and the in-wake guarantee
 * that a stray --conversationId cannot redirect the owner change off the wake
 * conversation.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import {
  __resetConversationsServiceForTests,
  type ConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import type { StaffProfile } from '@modules/team/schema'
import { __resetStaffServiceForTests, installStaffService, type StaffService } from '@modules/team/service/staff'
import type { VerbContext } from '@vobase/core'

import { convSetOwnerVerb } from './conv-set-owner'

function makeAgentCtx(overrides: Partial<VerbContext> = {}): VerbContext {
  return {
    organizationId: 'org-test',
    principal: { kind: 'agent', id: 'agt-001' },
    wake: { conversationId: 'conv-test', contactId: 'contact-001', wakeId: 'wake-001', turnIndex: 0 },
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

// Records every conversationId setOwner is invoked with.
function installOwnerStub(targets: string[]): void {
  installConversationsService({
    setOwner: (convId: string, ownerUserId: string | null) => {
      targets.push(convId)
      return Promise.resolve({ id: convId, ownerUserId, organizationId: 'org-test', status: 'active' } as never)
    },
  } as unknown as ConversationsService)
}

afterEach(() => {
  __resetConversationsServiceForTests()
  __resetStaffServiceForTests()
})

describe('convSetOwnerVerb', () => {
  it('sets the owner on the wake conversation', async () => {
    installStaffStub()
    const targets: string[] = []
    installOwnerStub(targets)

    const result = await convSetOwnerVerb.body({ input: { to: `user:${ALICE.userId}` }, ctx: makeAgentCtx() })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.ownerUserId).toBe(ALICE.userId)
    expect(targets).toEqual(['conv-test'])
  })

  describe('wake conversation is authoritative', () => {
    it('ignores a stray --conversationId inside a wake and sets the owner on the wake conversation', async () => {
      installStaffStub()
      const targets: string[] = []
      installOwnerStub(targets)

      const result = await convSetOwnerVerb.body({
        input: { to: `user:${ALICE.userId}`, conversationId: 'chi-stray' },
        ctx: makeAgentCtx(),
      })

      expect(result.ok).toBe(true)
      expect(targets).toEqual(['conv-test'])
    })

    it('honors --conversationId for out-of-wake HTTP-RPC callers (no wake)', async () => {
      installStaffStub()
      const targets: string[] = []
      installOwnerStub(targets)

      const result = await convSetOwnerVerb.body({
        input: { to: `user:${ALICE.userId}`, conversationId: 'http-conv-9' },
        ctx: makeAgentCtx({ wake: undefined }),
      })

      expect(result.ok).toBe(true)
      expect(targets).toEqual(['http-conv-9'])
    })
  })
})

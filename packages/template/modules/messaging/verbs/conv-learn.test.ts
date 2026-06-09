/**
 * conv-learn verb unit tests.
 *
 * Stubs the conversations + manual-learning singletons so no Postgres is needed.
 * Covers conversationId resolution, org scoping, happy-path delegation, and the
 * typed ManualLearningError → errorCode mapping.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import {
  __resetConversationsServiceForTests,
  type ConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import {
  __resetManualLearningServiceForTests,
  installManualLearningService,
  ManualLearningError,
  type ManualLearningResult,
  type ManualLearningService,
} from '@modules/messaging/service/manual-learning'
import type { VerbContext } from '@vobase/core'

import { convLearnVerb } from './conv-learn'

function makeCtx(overrides: Partial<VerbContext> = {}): VerbContext {
  return {
    organizationId: 'org-test',
    principal: { kind: 'user', id: 'usr-staff-1' },
    wake: { conversationId: 'conv-test', contactId: 'contact-001', wakeId: 'wake-001', turnIndex: 0 },
    ...overrides,
  }
}

function installConvStub(organizationId: string | null): void {
  installConversationsService({
    get: (id: string) =>
      organizationId === null
        ? Promise.reject(new Error('not found'))
        : Promise.resolve({ id, organizationId, assignee: 'unassigned', status: 'active' } as never),
  } as unknown as ConversationsService)
}

function installLearnStub(result: ManualLearningResult | ManualLearningError): void {
  installManualLearningService({
    triggerLearning: () => (result instanceof ManualLearningError ? Promise.reject(result) : Promise.resolve(result)),
  } as ManualLearningService)
}

// Records every conversationId triggerLearning is invoked with.
function installLearnCapture(targets: string[]): void {
  installManualLearningService({
    triggerLearning: (args: { conversationId: string }) => {
      targets.push(args.conversationId)
      return Promise.resolve({ agentId: 'agt0test01', windowCount: 1, messageCount: 3 })
    },
  } as ManualLearningService)
}

afterEach(() => {
  __resetConversationsServiceForTests()
  __resetManualLearningServiceForTests()
})

describe('convLearnVerb', () => {
  it('requires a conversationId when none is in the wake or input', async () => {
    const result = await convLearnVerb.body({ input: {}, ctx: makeCtx({ wake: undefined }) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('invalid_input')
  })

  it('delegates to the producer and summarises the queued windows', async () => {
    installConvStub('org-test')
    installLearnStub({ agentId: 'agt0test01', windowCount: 2, messageCount: 25 })

    const result = await convLearnVerb.body({ input: {}, ctx: makeCtx() })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.windowCount).toBe(2)
      expect(result.data.agentId).toBe('agt0test01')
      expect(result.summary).toMatch(/2/)
    }
  })

  it('refuses a conversation from another organization', async () => {
    installConvStub('org-other')
    installLearnStub({ agentId: 'agt0test01', windowCount: 1, messageCount: 3 })

    const result = await convLearnVerb.body({ input: { conversationId: 'conv-x' }, ctx: makeCtx() })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('forbidden')
  })

  it('maps a ManualLearningError to its errorCode', async () => {
    installConvStub('org-test')
    installLearnStub(new ManualLearningError('no_agent', 'no agent resolved'))

    const result = await convLearnVerb.body({ input: {}, ctx: makeCtx() })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('no_agent')
  })

  describe('wake conversation is authoritative', () => {
    it('ignores a stray --conversationId inside a wake and learns on the wake conversation', async () => {
      installConvStub('org-test') // any id resolves to org-test, so the org guard passes either way
      const learnTargets: string[] = []
      installLearnCapture(learnTargets)

      const result = await convLearnVerb.body({ input: { conversationId: 'conv-elsewhere' }, ctx: makeCtx() })

      expect(result.ok).toBe(true)
      expect(learnTargets).toEqual(['conv-test'])
    })

    it('honors --conversationId for out-of-wake HTTP-RPC callers (no wake)', async () => {
      installConvStub('org-test')
      const learnTargets: string[] = []
      installLearnCapture(learnTargets)

      const result = await convLearnVerb.body({
        input: { conversationId: 'http-conv-9' },
        ctx: makeCtx({ wake: undefined }),
      })

      expect(result.ok).toBe(true)
      expect(learnTargets).toEqual(['http-conv-9'])
    })
  })
})

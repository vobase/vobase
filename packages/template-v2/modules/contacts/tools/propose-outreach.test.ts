import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetPendingApprovalsServiceForTests,
  installPendingApprovalsService,
  type PendingApprovalsService,
} from '@modules/messaging/service/pending-approvals'
import type { ToolContext } from '@vobase/core'

import { proposeOutreachTool } from './propose-outreach'

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
  __resetPendingApprovalsServiceForTests()
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

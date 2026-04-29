import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetPendingApprovalsServiceForTests,
  installPendingApprovalsService,
  type PendingApprovalsService,
} from '@modules/messaging/service/pending-approvals'
import type { ToolContext } from '@vobase/core'

import { draftEmailToReviewTool } from './draft-email-to-review'

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

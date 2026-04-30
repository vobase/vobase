import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetConversationsServiceForTests,
  type ConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import type { ToolContext } from '@vobase/core'

import { summarizeInboxTool } from './summarize-inbox'

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
  __resetConversationsServiceForTests()
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

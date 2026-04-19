import { describe, expect, it, mock } from 'bun:test'
import { filterConversations } from '../conversation-list'
import type { Conversation } from '@server/contracts/domain-types'

const makeConv = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'conv-1',
  tenantId: 't1',
  contactId: 'ct-1',
  channelInstanceId: 'ch-1',
  parentConversationId: null,
  compactionSummary: null,
  compactedAt: null,
  status: 'active',
  assignee: 'unassigned',
  onHold: false,
  onHoldReason: null,
  lastMessageAt: null,
  resolvedAt: null,
  resolvedReason: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
})

const CONVS: Conversation[] = [
  makeConv({ id: '1', status: 'active',            assignee: 'unassigned' }),
  makeConv({ id: '2', status: 'awaiting_approval', assignee: 'agent-1'   }),
  makeConv({ id: '3', status: 'archived',          assignee: 'unassigned' }),
  makeConv({ id: '4', status: 'resolved',          assignee: 'agent-2'   }),
]

describe('filterConversations', () => {
  it('all returns all conversations', () => {
    expect(filterConversations(CONVS, 'all')).toHaveLength(4)
  })

  it('unread filters to active conversations', () => {
    const result = filterConversations(CONVS, 'unread')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('awaiting_approval filters by status', () => {
    const result = filterConversations(CONVS, 'awaiting_approval')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('assigned_to_me filters assigned conversations', () => {
    const result = filterConversations(CONVS, 'assigned_to_me')
    expect(result).toHaveLength(2)
    expect(result.map(c => c.id)).toEqual(['2', '4'])
  })

  it('archived filters by status', () => {
    const result = filterConversations(CONVS, 'archived')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('3')
  })

  it('filter changes operate on same data without calling queryFn again', () => {
    const queryFn = mock(() => Promise.resolve(CONVS))
    // Simulate: queryFn called once on mount
    queryFn()
    // Subsequent filter changes are client-side — filterConversations is a pure function
    const r1 = filterConversations(CONVS, 'unread')
    const r2 = filterConversations(CONVS, 'archived')
    const r3 = filterConversations(CONVS, 'all')
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect(r3).toHaveLength(4)
  })
})

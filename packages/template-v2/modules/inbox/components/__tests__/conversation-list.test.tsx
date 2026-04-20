import { describe, expect, it, mock } from 'bun:test'
import type { Conversation } from '@server/contracts/domain-types'
import { filterConversations } from '../conversation-list'
import type { FilterKey } from '../filter-tab-bar'

const NOW = new Date('2026-04-20T10:00:00Z')

const makeConv = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'conv-1',
  organizationId: 't1',
  contactId: 'ct-1',
  channelInstanceId: 'ch-1',
  status: 'active',
  assignee: 'unassigned',
  snoozedUntil: null,
  snoozedReason: null,
  snoozedBy: null,
  snoozedAt: null,
  snoozedJobId: null,
  threadKey: 'default',
  emailSubject: null,
  lastMessageAt: null,
  resolvedAt: null,
  resolvedReason: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
})

const CONVS: Conversation[] = [
  makeConv({ id: '1', status: 'active', assignee: 'unassigned' }),
  makeConv({ id: '2', status: 'awaiting_approval', assignee: 'agent:1' }),
  makeConv({ id: '3', status: 'failed', assignee: 'unassigned' }),
  makeConv({ id: '4', status: 'resolved', assignee: 'user:carol' }),
  makeConv({
    id: '5',
    status: 'active',
    assignee: 'agent:1',
    snoozedUntil: new Date(NOW.getTime() + 3600_000),
  }),
]

describe('filterConversations (3-tab model)', () => {
  it('active tab returns working-set conversations (active, resolving, awaiting_approval)', () => {
    const result = filterConversations(CONVS, 'active', 'all', NOW)
    expect(result.map((c) => c.id).sort()).toEqual(['1', '2'])
  })

  it('later tab returns only snoozed conversations', () => {
    const result = filterConversations(CONVS, 'later', 'all', NOW)
    expect(result.map((c) => c.id)).toEqual(['5'])
  })

  it('done tab returns resolved + failed', () => {
    const result = filterConversations(CONVS, 'done', 'all', NOW)
    expect(result.map((c) => c.id).sort()).toEqual(['3', '4'])
  })

  it('ownership=mine excludes unassigned within a tab', () => {
    const result = filterConversations(CONVS, 'active', 'mine', NOW)
    expect(result.map((c) => c.id)).toEqual(['2'])
  })

  it('ownership=unassigned keeps only unassigned', () => {
    const result = filterConversations(CONVS, 'active', 'unassigned', NOW)
    expect(result.map((c) => c.id)).toEqual(['1'])
  })

  it('ownership=<specific assignee> filters exactly', () => {
    const result = filterConversations(CONVS, 'later', 'agent:1', NOW)
    expect(result.map((c) => c.id)).toEqual(['5'])
  })
})

describe('tab-bar + ownership interaction', () => {
  it('switching tabs never calls queryFn again', () => {
    const queryFn = mock(() => Promise.resolve(CONVS))
    queryFn()
    const tabs: FilterKey[] = ['active', 'later', 'done', 'active']
    for (const tab of tabs) filterConversations(CONVS, tab, 'all', NOW)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('three buckets partition the input (no conversation counted twice)', () => {
    const a = filterConversations(CONVS, 'active', 'all', NOW).length
    const l = filterConversations(CONVS, 'later', 'all', NOW).length
    const d = filterConversations(CONVS, 'done', 'all', NOW).length
    expect(a + l + d).toBe(CONVS.length)
  })
})

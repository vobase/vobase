import { describe, expect, it, mock } from 'bun:test'
import type { LearningProposal } from '@server/contracts/domain-types'
import { renderToStaticMarkup } from 'react-dom/server'

let learningsMock: LearningProposal[] = []

mock.module('@/hooks/use-pending-learnings', () => ({
  usePendingLearnings: () => ({ data: learningsMock, handleDecide: async () => {} }),
}))

mock.module('@/components/ui/relative-time', () => ({
  RelativeTimeCard: ({ date }: { date: Date }) => <span data-testid="relative-time">{date.toISOString()}</span>,
}))

import { RecentLearningsPanel } from '../recent-learnings-panel'

function makeLearning(overrides: Partial<LearningProposal> = {}): LearningProposal {
  return {
    id: 'l1',
    organizationId: 't1',
    conversationId: 'conv_abc',
    wakeEventId: null,
    scope: 'agent_memory',
    action: 'upsert',
    target: 'memory',
    body: 'Learned something useful',
    rationale: null,
    confidence: null,
    status: 'pending',
    decidedByUserId: null,
    decidedAt: null,
    decidedNote: null,
    approvedWriteId: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('RecentLearningsPanel', () => {
  it('renders empty state when no learnings for conversation', () => {
    learningsMock = []
    const html = renderToStaticMarkup(<RecentLearningsPanel conversationId="conv_abc" />)
    expect(html).toContain('No recent learnings')
  })

  it('renders learning scope and body', () => {
    learningsMock = [makeLearning()]
    const html = renderToStaticMarkup(<RecentLearningsPanel conversationId="conv_abc" />)
    expect(html).toContain('agent_memory')
    expect(html).toContain('Learned something useful')
  })

  it('renders status badge', () => {
    learningsMock = [makeLearning({ status: 'approved' })]
    const html = renderToStaticMarkup(<RecentLearningsPanel conversationId="conv_abc" />)
    expect(html).toContain('approved')
  })

  it('filters out learnings from other conversations', () => {
    learningsMock = [makeLearning({ conversationId: 'conv_other', body: 'Other conv data' })]
    const html = renderToStaticMarkup(<RecentLearningsPanel conversationId="conv_abc" />)
    expect(html).toContain('No recent learnings')
    expect(html).not.toContain('Other conv data')
  })
})

import { describe, expect, it, mock } from 'bun:test'
import type { PendingApproval } from '@server/contracts/domain-types'
import * as realQuery from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@tanstack/react-query', () => ({
  ...realQuery,
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (String(queryKey[0]) === 'approvals') {
      return {
        data: [makePendingApproval({ id: 'a1', conversationId: 'conv_123' })],
      }
    }
    return { data: [] }
  },
  useMutation: () => ({ mutate: mock(() => {}), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: mock(() => {}), getQueryData: mock(() => undefined) }),
}))

function makePendingApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'approval_abc',
    tenantId: 'tenant_meridian',
    conversationId: 'conv_123',
    conversationEventId: null,
    toolName: 'send_card',
    toolArgs: { template: 'pricing', contactId: 'c_001' },
    status: 'pending',
    decidedByUserId: null,
    decidedAt: null,
    decidedNote: null,
    agentSnapshot: null,
    createdAt: new Date('2026-04-19T10:00:00Z'),
    ...overrides,
  }
}

import { InlineApprovalBanner } from '../inline-approval-banner'

describe('InlineApprovalBanner — renders when pending', () => {
  it('shows tool name', () => {
    const html = renderToStaticMarkup(<InlineApprovalBanner conversationId="conv_123" />)
    expect(html).toContain('send_card')
  })

  it('shows Approve button', () => {
    const html = renderToStaticMarkup(<InlineApprovalBanner conversationId="conv_123" />)
    expect(html).toContain('Approve')
  })

  it('shows Reject button', () => {
    const html = renderToStaticMarkup(<InlineApprovalBanner conversationId="conv_123" />)
    expect(html).toContain('Reject')
  })

  it('uses info color token for background', () => {
    const html = renderToStaticMarkup(<InlineApprovalBanner conversationId="conv_123" />)
    expect(html).toContain('color-info')
  })

  it('shows pending approval label', () => {
    const html = renderToStaticMarkup(<InlineApprovalBanner conversationId="conv_123" />)
    expect(html).toContain('Pending approval')
  })
})

describe('InlineApprovalBanner — hidden when no pending', () => {
  it('renders nothing when no approvals match conversationId', () => {
    const html = renderToStaticMarkup(<InlineApprovalBanner conversationId="conv_other" />)
    expect(html).toBe('')
  })
})

describe('InlineApprovalBanner — decide dispatch', () => {
  it('approve dispatches with approved decision', () => {
    const decide = mock<(_args: { id: string; conversationId: string; decision: 'approved' | 'rejected' }) => void>(
      () => {},
    )
    const approval = makePendingApproval({ id: 'a1', conversationId: 'conv_123' })
    const dispatch = (d: 'approved' | 'rejected') =>
      decide({ id: approval.id, conversationId: approval.conversationId, decision: d })
    dispatch('approved')
    expect(decide).toHaveBeenCalledWith({ id: 'a1', conversationId: 'conv_123', decision: 'approved' })
  })

  it('reject dispatches with rejected decision', () => {
    const decide = mock<(_args: { id: string; conversationId: string; decision: 'approved' | 'rejected' }) => void>(
      () => {},
    )
    const approval = makePendingApproval({ id: 'a1', conversationId: 'conv_123' })
    const dispatch = (d: 'approved' | 'rejected') =>
      decide({ id: approval.id, conversationId: approval.conversationId, decision: d })
    dispatch('rejected')
    expect(decide).toHaveBeenCalledWith({ id: 'a1', conversationId: 'conv_123', decision: 'rejected' })
  })
})

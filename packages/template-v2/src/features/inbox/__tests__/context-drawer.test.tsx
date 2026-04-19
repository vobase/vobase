import { describe, expect, it, mock } from 'bun:test'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@/features/inbox/profile-panel', () => ({
  ProfilePanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="profile-panel" data-conv={conversationId}>
      <dl>
        <dt>Name</dt>
        <dd>—</dd>
        <dt>Phone</dt>
        <dd>—</dd>
        <dt>Email</dt>
        <dd>—</dd>
      </dl>
    </div>
  ),
}))

mock.module('@/features/inbox/pending-approvals-panel', () => ({
  PendingApprovalsPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="pending-approvals-panel" data-conv={conversationId}>
      No pending approvals
    </div>
  ),
}))

mock.module('@/features/inbox/working-memory-panel', () => ({
  WorkingMemoryPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="working-memory-panel" data-conv={conversationId} />
  ),
}))

mock.module('@/features/inbox/recent-learnings-panel', () => ({
  RecentLearningsPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="recent-learnings-panel" data-conv={conversationId} />
  ),
}))

import { ContextDrawer } from '../context-drawer'

function render(ui: React.ReactNode, searchParams = '') {
  return renderToStaticMarkup(<NuqsTestingAdapter searchParams={searchParams}>{ui}</NuqsTestingAdapter>)
}

describe('ContextDrawer', () => {
  it('renders 4 section labels', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />)
    expect(html).toContain('Profile')
    expect(html).toContain('Working Memory')
    expect(html).toContain('Recent Learnings')
    expect(html).toContain('Pending Approvals')
  })

  it('renders all 4 panels by default (all sections expanded)', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />)
    expect(html).toContain('profile-panel')
    expect(html).toContain('working-memory-panel')
    expect(html).toContain('recent-learnings-panel')
    expect(html).toContain('pending-approvals-panel')
  })

  it('passes conversationId to all 4 panels', () => {
    const html = render(<ContextDrawer conversationId="conv_xyz" />)
    expect(html.match(/data-conv="conv_xyz"/g)?.length).toBe(4)
  })

  it('renders close button with aria-label="Close"', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />)
    expect(html).toContain('aria-label="Close"')
  })

  it('all section triggers are aria-expanded true by default', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />)
    const expanded = html.match(/aria-expanded="true"/g) ?? []
    expect(expanded.length).toBeGreaterThanOrEqual(4)
  })

  it('section trigger is aria-expanded false when section in collapsed param', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />, 'collapsed=profile')
    expect(html).toContain('aria-expanded="false"')
  })
})

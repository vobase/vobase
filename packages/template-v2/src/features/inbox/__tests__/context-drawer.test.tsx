import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderToStaticMarkup } from 'react-dom/server'

// Mock data hooks to avoid real fetch in SSR tests
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

import { ContextDrawer } from '../context-drawer'

function render(ui: React.ReactNode, searchParams = '') {
  return renderToStaticMarkup(<NuqsTestingAdapter searchParams={searchParams}>{ui}</NuqsTestingAdapter>)
}

describe('ContextDrawer', () => {
  it('renders PaneHeader with title "Context"', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />)
    expect(html).toContain('Context')
  })

  it('renders close button with aria-label="Close"', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />)
    expect(html).toContain('aria-label="Close"')
  })

  it('renders ProfilePanel', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />)
    expect(html).toContain('profile-panel')
  })

  it('renders PendingApprovalsPanel', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />)
    expect(html).toContain('pending-approvals-panel')
  })

  it('passes conversationId to both panels', () => {
    const html = render(<ContextDrawer conversationId="conv_xyz" />)
    expect(html.match(/data-conv="conv_xyz"/g)?.length).toBe(2)
  })

  it('applies detail density to PaneHeader', () => {
    const html = render(<ContextDrawer conversationId="conv_abc" />)
    expect(html).toContain('px-4')
  })
})

import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const signOutMock = mock(async () => {})

mock.module('@/lib/auth-client', () => ({
  authClient: { signOut: signOutMock, emailOtp: { sendVerificationOtp: mock(async () => {}), signIn: mock(async () => {}) } },
}))

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => mock(() => {}),
  useRouterState: () => '',
}))

// AlertDialog uses Radix Portal which renders nothing in renderToStaticMarkup.
// Stub it to render children inline so we can assert on content.
mock.module('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))

import { SignOutDialog } from '../sign-out-dialog'

describe('SignOutDialog — render', () => {
  it('renders sign out title when open', () => {
    const html = renderToStaticMarkup(<SignOutDialog open={true} onOpenChange={() => {}} />)
    expect(html).toContain('Sign out')
  })

  it('renders cancel and confirm buttons', () => {
    const html = renderToStaticMarkup(<SignOutDialog open={true} onOpenChange={() => {}} />)
    expect(html).toContain('Cancel')
    expect(html).toContain('Sign out')
  })

  it('renders description text', () => {
    const html = renderToStaticMarkup(<SignOutDialog open={true} onOpenChange={() => {}} />)
    expect(html).toContain('login')
  })

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(<SignOutDialog open={false} onOpenChange={() => {}} />)
    expect(html).toBe('')
  })
})

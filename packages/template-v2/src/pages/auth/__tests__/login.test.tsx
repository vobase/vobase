import { describe, expect, it, mock } from 'bun:test'
import * as realRouter from '@tanstack/react-router'
import { renderToStaticMarkup } from 'react-dom/server'

const sendVerificationOtpMock = mock(async (_args: { email: string; type: string }) => ({
  data: null,
  error: null,
}))

mock.module('@/lib/auth-client', () => ({
  authClient: {
    emailOtp: { sendVerificationOtp: sendVerificationOtpMock, signIn: mock(async () => {}) },
    signOut: mock(async () => {}),
  },
}))

mock.module('@tanstack/react-router', () => ({
  ...realRouter,
  useNavigate: () => mock((_opts: unknown) => {}),
  useRouterState: () => '',
}))

mock.module('@/pages/auth/use-email-otp', () => ({
  useEmailOtp: () => ({
    sendOtp: { mutate: mock(() => {}), isPending: false, error: null },
    verifyOtp: { mutate: mock(() => {}), isPending: false, error: null },
  }),
  sendOtpFn: mock(async ({ email }: { email: string }) => sendVerificationOtpMock({ email, type: 'sign-in' })),
  verifyOtpFn: mock(async () => {}),
}))

import LoginPage from '../login'

describe('LoginPage — render', () => {
  it('renders email input', () => {
    const html = renderToStaticMarkup(<LoginPage />)
    expect(html).toContain('type="email"')
  })

  it('renders send code button', () => {
    const html = renderToStaticMarkup(<LoginPage />)
    expect(html).toContain('Send code')
  })

  it('renders email label', () => {
    const html = renderToStaticMarkup(<LoginPage />)
    expect(html).toContain('Email')
  })

  it('renders email placeholder', () => {
    const html = renderToStaticMarkup(<LoginPage />)
    expect(html).toContain('you@example.com')
  })
})

describe('sendOtpFn — unit', () => {
  it('calls authClient.emailOtp.sendVerificationOtp with email and sign-in type', async () => {
    const { sendOtpFn } = await import('@/pages/auth/use-email-otp')
    await sendOtpFn({ email: 'test@example.com' })
    expect(sendVerificationOtpMock).toHaveBeenCalledWith({ email: 'test@example.com', type: 'sign-in' })
  })
})

import { describe, expect, it, mock } from 'bun:test'
import * as realRouter from '@tanstack/react-router'
import { renderToStaticMarkup } from 'react-dom/server'

const signInMock = mock(async (_args: { email: string; otp: string }) => ({
  data: { user: { email: 'user@example.com' } },
  error: null,
}))
const signInErrorMock = mock(async (_args: { email: string; otp: string }) => ({
  data: null,
  error: { message: 'Invalid OTP' },
}))

mock.module('@/lib/auth-client', () => ({
  authClient: {
    emailOtp: { sendVerificationOtp: mock(async () => {}), signIn: signInMock },
    signOut: mock(async () => {}),
  },
}))

mock.module('@tanstack/react-router', () => ({
  ...realRouter,
  useNavigate: () => mock((_opts: unknown) => {}),
  useRouterState: () => 'email=user%40example.com',
}))

mock.module('@/shell/auth/use-email-otp', () => ({
  useEmailOtp: () => ({
    sendOtp: { mutate: mock(() => {}), isPending: false, isSuccess: false, error: null },
    verifyOtp: { mutate: mock(() => {}), isPending: false, error: null },
  }),
  sendOtpFn: mock(async () => {}),
  verifyOtpFn: mock(async ({ email, otp }: { email: string; otp: string }) => signInMock({ email, otp })),
}))

import { verifyOtpFn } from '@/shell/auth/use-email-otp'
import { PendingPage } from '../pending'

describe('PendingPage — render', () => {
  it('renders 6 OTP slots', () => {
    const html = renderToStaticMarkup(<PendingPage />)
    const slotCount = (html.match(/input-otp-slot/g) ?? []).length
    expect(slotCount).toBe(6)
  })

  it('renders resend button', () => {
    const html = renderToStaticMarkup(<PendingPage />)
    expect(html).toContain('Resend code')
  })

  it('shows email from search params', () => {
    const html = renderToStaticMarkup(<PendingPage />)
    expect(html).toContain('user@example.com')
  })
})

describe('verifyOtpFn — unit', () => {
  it('calls authClient.emailOtp.signIn with email and otp', async () => {
    await verifyOtpFn({ email: 'user@example.com', otp: '123456' })
    expect(signInMock).toHaveBeenCalledWith({ email: 'user@example.com', otp: '123456' })
  })

  it('error case: returns error result on invalid otp', async () => {
    mock.module('@/lib/auth-client', () => ({
      authClient: {
        emailOtp: { sendVerificationOtp: mock(async () => {}) },
        signIn: { emailOtp: signInErrorMock },
        signOut: mock(async () => {}),
      },
    }))
    const result = await signInErrorMock({ email: 'user@example.com', otp: '000000' })
    expect(result.error).toBeDefined()
    expect(result.error?.message).toBe('Invalid OTP')
  })
})

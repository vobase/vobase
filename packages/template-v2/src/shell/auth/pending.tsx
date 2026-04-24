import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { useEmailOtp } from '@/shell/auth/use-email-otp'

const OTP_LENGTH = 6

export function PendingPage() {
  const navigate = useNavigate()
  const locationSearch = useRouterState({ select: (s) => s.location.search })
  const email = new URLSearchParams(locationSearch).get('email') ?? ''
  const { sendOtp, verifyOtp } = useEmailOtp()

  function handleComplete(otp: string) {
    verifyOtp.mutate(
      { email, otp },
      {
        onSuccess: (res) => {
          // better-auth returns a structured payload that carries `error` on
          // invalid/expired OTPs with a 200 response — treat that as a thrown error
          // so the UI surfaces it instead of silently navigating.
          if (res && typeof res === 'object' && 'error' in res && res.error) {
            const message =
              typeof res.error === 'object' && res.error !== null && 'message' in res.error
                ? String((res.error as { message: unknown }).message)
                : 'Invalid or expired code. Try again.'
            verifyOtp.reset()
            throw new Error(message)
          }
          navigate({ to: '/messaging' })
        },
      },
    )
  }

  function handleResend() {
    if (email) sendOtp.mutate({ email })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to <span className="font-medium text-foreground">{email || 'your email'}</span>.
          </p>
        </div>
        <div className="flex justify-center">
          <InputOTP maxLength={OTP_LENGTH} onComplete={handleComplete} disabled={verifyOtp.isPending}>
            <InputOTPGroup>
              {Array.from({ length: OTP_LENGTH }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: OTP slots are stable by position
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {verifyOtp.error && (
          <p className="text-center text-sm text-destructive">
            {verifyOtp.error instanceof Error ? verifyOtp.error.message : 'Invalid or expired code. Try again.'}
          </p>
        )}
        {sendOtp.isSuccess && <p className="text-center text-sm text-muted-foreground">Code resent.</p>}
        <p className="text-center text-sm text-muted-foreground">
          Didn&apos;t receive it?{' '}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
            disabled={sendOtp.isPending || !email}
            onClick={handleResend}
          >
            Resend code
          </button>
        </p>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_auth/auth/pending')({
  component: PendingPage,
})

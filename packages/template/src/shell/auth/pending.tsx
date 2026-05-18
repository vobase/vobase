import { useMutation } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { authClient } from '@/lib/auth-client'
import { useEmailOtp } from '@/shell/auth/use-email-otp'

const OTP_LENGTH = 6

type AuthClientResult = { error?: { message?: string; code?: string } | null } | null | undefined

function readErrorMessage(res: AuthClientResult, fallback: string): string | null {
  if (res && typeof res === 'object' && 'error' in res && res.error) {
    const err = res.error
    if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
      return err.message
    }
    return fallback
  }
  return null
}

// biome-ignore lint/suspicious/useAwait: mutation contract must be async
async function sendPhoneOtp({ phoneNumber }: { phoneNumber: string }) {
  return authClient.phoneNumber.sendOtp({ phoneNumber })
}

// biome-ignore lint/suspicious/useAwait: mutation contract must be async
async function verifyPhoneOtp({ phoneNumber, code }: { phoneNumber: string; code: string }) {
  return authClient.phoneNumber.verify({ phoneNumber, code })
}

export function PendingPage() {
  const navigate = useNavigate()
  const locationSearch = useRouterState({ select: (s) => s.location.search })
  const params = new URLSearchParams(locationSearch)
  const mode = params.get('mode') === 'phone' ? 'phone' : 'email'
  const email = params.get('email') ?? ''
  const phoneNumber = params.get('phoneNumber') ?? ''
  const invitationId = params.get('invitationId') ?? ''
  const { sendOtp: sendEmailOtp, verifyOtp: verifyEmailOtp } = useEmailOtp()
  const sendPhone = useMutation({ mutationFn: sendPhoneOtp })
  const verifyPhone = useMutation({ mutationFn: verifyPhoneOtp })
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)

  function handleEmailComplete(otp: string) {
    verifyEmailOtp.mutate(
      { email, otp },
      {
        onSuccess: async (res) => {
          // better-auth returns a structured payload that carries `error` on
          // invalid/expired OTPs with a 200 response — treat that as a thrown error
          // so the UI surfaces it instead of silently navigating.
          if (res && typeof res === 'object' && 'error' in res && res.error) {
            const message =
              typeof res.error === 'object' && res.error !== null && 'message' in res.error
                ? String((res.error as { message: unknown }).message)
                : 'Invalid or expired code. Try again.'
            verifyEmailOtp.reset()
            throw new Error(message)
          }
          // If we arrived here from an invite email, accept the invitation
          // explicitly so the invite-redirect middleware can steer unverified
          // joiners into /onboard/verify-phone before the inbox.
          if (invitationId) {
            try {
              const acceptRes = await authClient.organization.acceptInvitation({ invitationId })
              // better-auth-react surfaces the middleware's 302 either as a
              // `redirect` field in the response body or by setting the
              // response URL on the fetch result. Honor whichever shape lands.
              const data = (acceptRes as { data?: unknown })?.data
              const redirect =
                data && typeof data === 'object' && 'redirect' in data && typeof data.redirect === 'string'
                  ? data.redirect
                  : null
              if (redirect?.startsWith('/')) {
                window.location.assign(redirect)
                return
              }
              if (acceptRes && typeof acceptRes === 'object' && 'error' in acceptRes && acceptRes.error) {
                const msg =
                  typeof acceptRes.error === 'object' && acceptRes.error !== null && 'message' in acceptRes.error
                    ? String((acceptRes.error as { message: unknown }).message)
                    : 'Invitation expired or invalid.'
                setInviteError(msg)
                return
              }
            } catch (err) {
              setInviteError(err instanceof Error ? err.message : 'Invitation could not be accepted.')
              return
            }
          }
          navigate({ to: '/inbox' })
        },
      },
    )
  }

  function handlePhoneComplete(otp: string) {
    setPhoneError(null)
    verifyPhone.mutate(
      { phoneNumber, code: otp },
      {
        onSuccess: (res) => {
          const message = readErrorMessage(
            res as AuthClientResult,
            'No account found for this WhatsApp number. Contact your admin to add you.',
          )
          if (message) {
            verifyPhone.reset()
            setPhoneError(message)
            return
          }
          navigate({ to: '/inbox' })
        },
      },
    )
  }

  function handleResend() {
    if (mode === 'phone') {
      if (phoneNumber) sendPhone.mutate({ phoneNumber })
    } else if (email) {
      sendEmailOtp.mutate({ email })
    }
  }

  const isPhone = mode === 'phone'
  const verifyPending = isPhone ? verifyPhone.isPending : verifyEmailOtp.isPending
  const verifyError = isPhone ? phoneError : null
  const emailVerifyError = !isPhone && verifyEmailOtp.error ? verifyEmailOtp.error : null
  const sendPending = isPhone ? sendPhone.isPending : sendEmailOtp.isPending
  const sendSuccess = isPhone ? sendPhone.isSuccess : sendEmailOtp.isSuccess
  const headline = isPhone ? 'Check your WhatsApp' : 'Check your email'
  const description = isPhone ? (
    <>
      We sent a 6-digit code over WhatsApp to{' '}
      <span className="font-medium text-foreground">{phoneNumber || 'your number'}</span>.
    </>
  ) : (
    <>
      We sent a 6-digit code to <span className="font-medium text-foreground">{email || 'your email'}</span>.
    </>
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-xl tracking-tight">{headline}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <div className="flex justify-center">
          <InputOTP
            maxLength={OTP_LENGTH}
            onComplete={isPhone ? handlePhoneComplete : handleEmailComplete}
            disabled={verifyPending}
          >
            <InputOTPGroup>
              {Array.from({ length: OTP_LENGTH }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: OTP slots are stable by position
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {emailVerifyError && (
          <p className="text-center text-destructive text-sm">
            {emailVerifyError instanceof Error ? emailVerifyError.message : 'Invalid or expired code. Try again.'}
          </p>
        )}
        {verifyError && <p className="text-center text-destructive text-sm">{verifyError}</p>}
        {inviteError && <p className="text-center text-destructive text-sm">{inviteError}</p>}
        {sendSuccess && <p className="text-center text-muted-foreground text-sm">Code resent.</p>}
        <p className="text-center text-muted-foreground text-sm">
          Didn&apos;t receive it?{' '}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
            disabled={sendPending || (isPhone ? !phoneNumber : !email)}
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

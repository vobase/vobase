import { E164_RE } from '@auth/e164'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { authClient } from '@/lib/auth-client'

const OTP_LENGTH = 6
const FALLBACK_DELAY_MS = 60_000

const phoneSchema = z.object({
  phoneNumber: z.string().regex(E164_RE, 'Enter your phone in international format, e.g. +6591234567'),
})

type PhoneValues = z.infer<typeof phoneSchema>

interface SessionUser {
  email?: string
}

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

function readErrorCode(res: AuthClientResult): string | null {
  if (res && typeof res === 'object' && 'error' in res && res.error) {
    const err = res.error
    if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
      return err.code
    }
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

// biome-ignore lint/suspicious/useAwait: mutation contract must be async
async function sendMagicLink({ email }: { email: string }) {
  return authClient.signIn.magicLink({ email, callbackURL: '/inbox' })
}

export function VerifyPhonePage() {
  const navigate = useNavigate()
  const locationSearch = useRouterState({ select: (s) => s.location.search })
  const nextPath = new URLSearchParams(locationSearch).get('next') ?? '/inbox'

  const sessionRes = authClient.useSession() as unknown as {
    data?: { user?: SessionUser | null } | null
  } | null
  const userEmail = sessionRes?.data?.user?.email ?? ''

  const [step, setStep] = useState<'phone' | 'code' | 'magic-sent' | 'template-unapproved'>('phone')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [fallbackVisible, setFallbackVisible] = useState(false)

  const sendOtp = useMutation({ mutationFn: sendPhoneOtp })
  const verifyOtp = useMutation({ mutationFn: verifyPhoneOtp })
  const magicLink = useMutation({ mutationFn: sendMagicLink })

  const phoneForm = useForm<PhoneValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phoneNumber: '' },
  })

  // After 60s in the code step with no successful verify, surface the fallback.
  useEffect(() => {
    if (step !== 'code') {
      setFallbackVisible(false)
      return
    }
    const t = window.setTimeout(() => setFallbackVisible(true), FALLBACK_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [step])

  function onSubmitPhone({ phoneNumber: pn }: PhoneValues) {
    sendOtp.mutate(
      { phoneNumber: pn },
      {
        onSuccess: (res) => {
          const code = readErrorCode(res as AuthClientResult)
          if (code === 'PHONE_OTP_TEMPLATE_UNAPPROVED' || code === 'phone_otp_template_unapproved') {
            setStep('template-unapproved')
            return
          }
          const message = readErrorMessage(res as AuthClientResult, 'Could not send the code. Try again.')
          if (message) {
            sendOtp.reset()
            phoneForm.setError('phoneNumber', { message })
            return
          }
          setPhoneNumber(pn)
          setStep('code')
        },
      },
    )
  }

  function handleVerifyComplete(code: string) {
    verifyOtp.mutate(
      { phoneNumber, code },
      {
        onSuccess: (res) => {
          const message = readErrorMessage(res as AuthClientResult, 'That code did not work. Try again.')
          if (message) {
            verifyOtp.reset()
            throw new Error(message)
          }
          navigate({ to: nextPath })
        },
      },
    )
  }

  function handleResend() {
    if (phoneNumber) sendOtp.mutate({ phoneNumber })
  }

  function handleUseDifferentPhone() {
    setStep('phone')
    setPhoneNumber('')
    sendOtp.reset()
    verifyOtp.reset()
  }

  function handleMagicLink() {
    if (!userEmail) return
    magicLink.mutate(
      { email: userEmail },
      {
        onSuccess: (res) => {
          const message = readErrorMessage(res as AuthClientResult, 'Could not send the sign-in link. Try again.')
          if (message) {
            magicLink.reset()
            throw new Error(message)
          }
          setStep('magic-sent')
        },
      },
    )
  }

  if (step === 'template-unapproved') {
    return (
      <div className="w-full max-w-sm px-4">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Phone verification is being set up</EmptyTitle>
            <EmptyDescription>
              Ask your admin to email you a magic-link sign-in instead, or come back in 24-72 hours.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              onClick={handleMagicLink}
              disabled={!userEmail || magicLink.isPending || magicLink.isSuccess}
            >
              {magicLink.isPending ? 'Sending…' : magicLink.isSuccess ? 'Sign-in link sent' : 'Send me a magic-link'}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  if (step === 'magic-sent') {
    return (
      <div className="w-full max-w-sm space-y-3 px-4 text-center">
        <h1 className="font-semibold text-xl tracking-tight">Check your email for a sign-in link.</h1>
        <p className="text-muted-foreground text-sm">
          We sent a one-time sign-in link to{' '}
          <span className="font-medium text-foreground">{userEmail || 'your email'}</span>.
        </p>
      </div>
    )
  }

  if (step === 'phone') {
    return (
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-xl tracking-tight">Verify your phone</h1>
          <p className="text-muted-foreground text-sm">
            We will send a one-time code over WhatsApp so the agent can reach you for notifications.
          </p>
        </div>
        <Form {...phoneForm}>
          <form onSubmit={phoneForm.handleSubmit(onSubmitPhone)} className="space-y-4">
            <FormField
              control={phoneForm.control}
              name="phoneNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone number</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      inputMode="tel"
                      placeholder="+6591234567"
                      autoComplete="tel"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Include your country code, starting with “+”.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {sendOtp.error && (
              <p className="text-destructive text-sm">
                {sendOtp.error instanceof Error ? sendOtp.error.message : 'Could not send the code. Try again.'}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={sendOtp.isPending}>
              {sendOtp.isPending ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        </Form>
      </div>
    )
  }

  // step === 'code'
  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Enter the code</h1>
        <p className="text-muted-foreground text-sm">
          We sent a 6-digit code over WhatsApp to <span className="font-medium text-foreground">{phoneNumber}</span>.
        </p>
      </div>
      <div className="flex justify-center">
        <InputOTP maxLength={OTP_LENGTH} onComplete={handleVerifyComplete} disabled={verifyOtp.isPending}>
          <InputOTPGroup>
            {Array.from({ length: OTP_LENGTH }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: OTP slots are stable by position
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      {verifyOtp.error && (
        <p className="text-center text-destructive text-sm">
          {verifyOtp.error instanceof Error ? verifyOtp.error.message : 'That code did not work. Try again.'}
        </p>
      )}
      {sendOtp.isSuccess && !sendOtp.isPending && (
        <p className="text-center text-muted-foreground text-sm">Code sent.</p>
      )}
      <div className="flex flex-col gap-2 text-center text-sm">
        <button
          type="button"
          className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
          disabled={sendOtp.isPending || !phoneNumber}
          onClick={handleResend}
        >
          Resend code
        </button>
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:underline"
          onClick={handleUseDifferentPhone}
        >
          Use a different phone
        </button>
      </div>
      {fallbackVisible && (
        <div className="space-y-2 border-t pt-4 text-center">
          <p className="text-muted-foreground text-sm">
            Didn&apos;t receive the code? Sign in with a magic-link instead.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleMagicLink}
            disabled={!userEmail || magicLink.isPending}
          >
            {magicLink.isPending ? 'Sending…' : 'Send me a magic-link'}
          </Button>
          {magicLink.error && (
            <p className="text-destructive text-sm">
              {magicLink.error instanceof Error ? magicLink.error.message : 'Could not send the sign-in link.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_auth/onboard/verify-phone')({
  component: VerifyPhonePage,
})

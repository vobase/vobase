/**
 * use-phone-verify — thin React wrapper over `phone-verify-engine`.
 *
 * Owns the send/verify mutations and the idle→code step state; delegates every
 * decision (updatePhoneNumber, error mapping) to the pure engine. On a
 * successful verify it refreshes the session store and invalidates the staff
 * list, because this write goes through better-auth (not a module service) and
 * so emits no `pg_notify` to drive realtime invalidation.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { authClient, refreshSession } from '@/lib/auth-client'
import { staffKeys } from '../hooks/use-staff'
import { normalizeAuthError, resolveVerifyArgs } from './phone-verify-engine'

export interface UsePhoneVerifyOptions {
  /** Number already saved on the account; drives the updatePhoneNumber decision. */
  savedPhone: string
  /** Called after a successful verify — session + staff list are already refreshed. */
  onVerified?: (phoneNumber: string) => void
}

export interface PhoneVerifyController {
  step: 'idle' | 'code'
  error: string | null
  /** True once the org's OTP template is unapproved — a terminal state; retrying can't succeed. */
  blocked: boolean
  isSending: boolean
  isVerifying: boolean
  send: (typed: string) => void
  verify: (typed: string, code: string) => void
  reset: () => void
}

export function usePhoneVerify({ savedPhone, onVerified }: UsePhoneVerifyOptions): PhoneVerifyController {
  const qc = useQueryClient()
  const [step, setStep] = useState<'idle' | 'code'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)

  const sendOtp = useMutation({
    mutationFn: (phoneNumber: string) => authClient.phoneNumber.sendOtp({ phoneNumber }),
  })
  const verifyOtp = useMutation({
    mutationFn: (vars: { phoneNumber: string; code: string; updatePhoneNumber: boolean }) =>
      authClient.phoneNumber.verify(vars),
  })

  function send(typed: string) {
    setError(null)
    sendOtp.mutate(typed.trim(), {
      onSuccess: (res) => {
        const { message, isTemplateUnapproved } = normalizeAuthError(res, 'send')
        if (message) {
          sendOtp.reset()
          setError(message)
          if (isTemplateUnapproved) setBlocked(true)
          return
        }
        setStep('code')
      },
      // better-auth normally resolves with `{ error }`; a thrown/network rejection
      // skips onSuccess, so surface a fallback rather than failing silently.
      onError: () => setError('Could not send the code. Try again.'),
    })
  }

  function verify(typed: string, code: string) {
    setError(null)
    const args = resolveVerifyArgs({ typed, saved: savedPhone, code })
    verifyOtp.mutate(args, {
      onSuccess: async (res) => {
        const { message, isTemplateUnapproved } = normalizeAuthError(res, 'verify')
        if (message) {
          verifyOtp.reset()
          setError(message)
          if (isTemplateUnapproved) setBlocked(true)
          return
        }
        await refreshSession()
        qc.invalidateQueries({ queryKey: staffKeys.all })
        onVerified?.(args.phoneNumber)
      },
      onError: () => setError('That code did not work. Try again.'),
    })
  }

  function reset() {
    setStep('idle')
    setError(null)
    setBlocked(false)
    sendOtp.reset()
    verifyOtp.reset()
  }

  return {
    step,
    error,
    blocked,
    isSending: sendOtp.isPending,
    isVerifying: verifyOtp.isPending,
    send,
    verify,
    reset,
  }
}

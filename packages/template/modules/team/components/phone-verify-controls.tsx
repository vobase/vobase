/**
 * PhoneVerifyControls — send-code button + OTP entry for verifying the
 * signed-in user's OWN WhatsApp number. Shared by the standalone
 * `PhoneVerifyDialog` and the edit-staff-profile dialog. Mount with a `key` on
 * the number so editing it resets the flow.
 */

import { E164_RE } from '@auth/e164'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { OTP_LENGTH } from './phone-verify-engine'
import { usePhoneVerify } from './use-phone-verify'

interface PhoneVerifyControlsProps {
  /** Current (possibly edited) E.164 number to verify. */
  phone: string
  /** Number already saved on the account. */
  savedPhone: string
  onVerified?: (phoneNumber: string) => void
}

export function PhoneVerifyControls({ phone, savedPhone, onVerified }: PhoneVerifyControlsProps) {
  const { step, error, blocked, isSending, isVerifying, send, verify } = usePhoneVerify({ savedPhone, onVerified })
  const [code, setCode] = useState('')
  const canSend = E164_RE.test(phone)
  const busy = isSending || isVerifying

  // input-otp only fires `onComplete` on the <full transition, so clear the
  // entered code after a failed verify — otherwise the bad digits linger and
  // retyping the same code never re-triggers the check.
  useEffect(() => {
    if (error) setCode('')
  }, [error])

  if (step === 'idle') {
    return (
      <div className="space-y-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => send(phone)}
          disabled={!canSend || busy || blocked}
        >
          {isSending ? 'Sending…' : 'Send verification code'}
        </Button>
        <p className="text-muted-foreground text-xs">
          Verify this number now to receive staff notifications on WhatsApp.
        </p>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">
        Enter the 6-digit code sent to <span className="font-medium text-foreground">{phone}</span> on WhatsApp.
      </p>
      <InputOTP
        maxLength={OTP_LENGTH}
        value={code}
        onChange={setCode}
        onComplete={(c) => verify(phone, c)}
        disabled={isVerifying}
      >
        <InputOTPGroup>
          {Array.from({ length: OTP_LENGTH }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: OTP slots are stable by position
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-muted-foreground text-xs"
        disabled={busy}
        onClick={() => send(phone)}
      >
        Resend code
      </Button>
    </div>
  )
}

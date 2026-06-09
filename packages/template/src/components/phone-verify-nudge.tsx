import { computeVerifyState } from '@modules/team/components/phone-verify-engine'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { useSessionUser } from '@/hooks/use-session-user'
import { useDialogs } from '@/providers/dialog-provider'

const NUDGE_ID = 'phone-verify-nudge'

/**
 * Persistent top-right nudge for a signed-in user whose own WhatsApp number is
 * set but unverified. In practice this is a user who clicked "Skip for now" on
 * the onboarding verify step: the `/_app` guard otherwise redirects unverified
 * users to `/onboard/verify-phone` before this even mounts. Dismissible via the
 * toast's close button; a dismissal is remembered for the tab session (so a
 * transient session refetch can't resurrect it) and the nudge auto-dismisses
 * the instant the number is verified. Renders nothing.
 */
export function PhoneVerifyNudge() {
  const user = useSessionUser()
  const { openPhoneVerify } = useDialogs()
  const { shouldNudge } = computeVerifyState(user)
  const dismissed = useRef(false)

  useEffect(() => {
    if (!shouldNudge) {
      toast.dismiss(NUDGE_ID)
      return
    }
    if (dismissed.current) return
    toast.warning('Verify your WhatsApp number', {
      id: NUDGE_ID,
      duration: Number.POSITIVE_INFINITY,
      position: 'top-right',
      description: 'Verify to receive staff notifications on WhatsApp.',
      action: {
        label: 'Verify now',
        // Keep the nudge up while the dialog is open — without preventDefault
        // sonner deletes the toast, so cancelling the dialog would lose it.
        onClick: (event) => {
          event.preventDefault()
          openPhoneVerify()
        },
      },
      onDismiss: () => {
        dismissed.current = true
      },
    })
  }, [shouldNudge, openPhoneVerify])

  return null
}

/**
 * Renders a small status pill beside a staff WhatsApp number that signals
 * whether the user has completed the `vobase_platform_otp` verification. An
 * unverified number cannot receive WhatsApp pings — the mention-notify
 * fan-out (`team/service/mention-notify.ts`) routes unverified staff to the
 * email fallback instead.
 */

import { Status } from '@/components/ui/status'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface PhoneVerificationBadgeProps {
  verified: boolean
  /** When true the badge is hidden (no phone set ⇒ nothing to verify). */
  hidden?: boolean
}

export function PhoneVerificationBadge({ verified, hidden }: PhoneVerificationBadgeProps) {
  if (hidden) return null
  const tip = verified
    ? 'Confirmed via a WhatsApp one-time code. Mention pings will be delivered.'
    : 'Cannot receive WhatsApp pings until verified. The owner will receive a one-time code on next sign-in.'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Status variant={verified ? 'success' : 'warning'} label={verified ? 'verified' : 'unverified'} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  )
}

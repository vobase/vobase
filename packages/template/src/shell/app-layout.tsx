import { HistorySyncToaster } from '@modules/channels/components/history-sync-toaster'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { AppShell } from '@/components/layout/app-shell'
import { PhoneVerifyNudge } from '@/components/phone-verify-nudge'
import { useRealtimeInvalidation } from '@/hooks/use-realtime-invalidation'
import { authClient } from '@/lib/auth-client'

/**
 * sessionStorage key set by `/onboard/verify-phone`'s "Skip for now" button.
 * Suppresses the redirect for the rest of the tab session; cleared by
 * sign-out (`SignOutDialog`) and naturally on tab close.
 */
export const SKIP_VERIFY_KEY = 'vobase:phone-verify-skipped'

/**
 * Route guard for the `/_app` layout. Two responsibilities:
 *   1. Require an authenticated session — redirect to /auth/login otherwise.
 *   2. Steer users who have a phone but haven't verified it yet to
 *      `/onboard/verify-phone?next=<original-target>` so a self-serve OTP
 *      flow exists for admin-set phone numbers (no phone → no redirect —
 *      owners/admins may not have one). The `/onboard/verify-phone` route
 *      lives under `/_auth`, NOT `/_app`, so it can't recurse into this guard.
 */
async function requireSession({ location }: { location: { href: string } }) {
  const res = await authClient.getSession()
  const data = (res as { data?: { session?: unknown; user?: unknown } | null } | null)?.data
  if (!data?.session) {
    throw redirect({ to: '/auth/login' })
  }
  // better-auth's phone-number plugin contributes both fields to the user
  // projection; pull them out defensively (null / undefined both treated as
  // "no phone" or "not verified").
  const user = data.user as { phoneNumber?: string | null; phoneNumberVerified?: boolean | null } | null | undefined
  const phone = user?.phoneNumber ?? null
  const verified = user?.phoneNumberVerified === true
  const skipped = typeof window !== 'undefined' && window.sessionStorage?.getItem(SKIP_VERIFY_KEY) === '1'
  if (phone && !verified && !skipped) {
    throw redirect({
      to: '/onboard/verify-phone',
      search: { next: location.href },
    })
  }
}

function AppLayout() {
  useRealtimeInvalidation()
  return (
    <AppShell>
      <PhoneVerifyNudge />
      <Outlet />
      <HistorySyncToaster />
    </AppShell>
  )
}

export const Route = createFileRoute('/_app')({
  beforeLoad: requireSession,
  component: AppLayout,
})

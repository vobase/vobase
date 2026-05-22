import { ContextDrawer } from '@modules/messaging/components/context-drawer'
import { ConversationList } from '@modules/messaging/components/conversation-list'
import { useGroupedConversations } from '@modules/messaging/hooks/use-grouped-conversations'
import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { ListDetailLayout } from '@/components/layout/list-detail-layout'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { authClient } from '@/lib/auth-client'

/**
 * US-019 — Phone-verification gate for newly-joined staff.
 *
 * Catches deep-links into /inbox/* from staff whose invite-acceptance redirect
 * (server-side middleware in `auth/invite-redirect.ts`) was bypassed (back/forward
 * nav, manual URL, race against the SPA's response handling). Only redirects
 * when BOTH conditions hold:
 *   (a) `session.user.phoneNumberVerified === false` — never trips for
 *       pre-existing org members who joined before the phone-OTP flow shipped
 *       (`phoneNumberVerified` is `null` for those rows).
 *   (b) `session.member.createdAt > now() - 24h` — the recency window scopes
 *       the hard redirect to brand-new joiners. Older unverified members get a
 *       soft banner elsewhere (per PRD US-019 AC #5; banner UI is out of scope
 *       for this story).
 *
 * Wakes the gate in `beforeLoad` so the SPA never paints inbox shell before
 * deciding. Auth-client call honors the same 5-min cookie cache used by the
 * dashboard's other session lookups (see `auth/index.ts::session.cookieCache`).
 */
const MEMBER_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000

async function requirePhoneVerifiedForRecentJoiner(): Promise<void> {
  const res = await authClient.getSession()
  // biome-ignore lint/suspicious/noExplicitAny: better-auth's typed-session shape varies by enabled plugins
  const session = (res as any)?.data
  if (!session) return // No session → the parent `_app` guard already redirects to /auth/login.

  const user = session.user as { phoneNumberVerified?: boolean | null } | undefined
  if (user?.phoneNumberVerified !== false) return // null (legacy) or true → no gate.

  // The better-auth session payload exposes the active membership at
  // `session.member`; if absent we cannot evaluate recency and must fail open
  // to avoid lockout (matches the soft-banner default for pre-existing members).
  const member = (session as { member?: { createdAt?: string | Date | null } }).member
  const createdAtRaw = member?.createdAt
  if (!createdAtRaw) return
  const createdAt = typeof createdAtRaw === 'string' ? new Date(createdAtRaw) : createdAtRaw
  if (Number.isNaN(createdAt.getTime())) return
  if (Date.now() - createdAt.getTime() > MEMBER_RECENCY_WINDOW_MS) return // Pre-existing: soft banner only.

  throw redirect({ to: '/onboard/verify-phone' as never, search: { next: '/inbox' } as never })
}

export function MessagingLayout() {
  const navigate = useNavigate()
  const isContactSelected = useRouterState({
    select: (s) => /^\/inbox\/.+/.test(s.location.pathname),
  })
  const contactId = useRouterState({
    select: (s) => {
      const match = /^\/inbox\/([^/?#]+)/.exec(s.location.pathname)
      return match?.[1] ?? null
    },
  })
  const { data: grouped } = useGroupedConversations()
  const convs = grouped?.rows ?? []
  const autoSelected = useRef(false)

  useEffect(() => {
    if (autoSelected.current || isContactSelected || convs.length === 0) return
    if (!matchMedia('(min-width: 1024px)').matches) return
    autoSelected.current = true
    void navigate({ to: '/inbox/$contactId', params: { contactId: convs[0].contactId }, replace: true })
  }, [convs, isContactSelected, navigate])

  useKeyboardNav({ context: 'messaging-list' })

  return (
    <ListDetailLayout
      list={<ConversationList />}
      detail={<Outlet />}
      right={contactId ? <ContextDrawer contactId={contactId} /> : undefined}
      mobileActive={isContactSelected ? 'detail' : 'list'}
    />
  )
}

export const Route = createFileRoute('/_app/inbox')({
  beforeLoad: requirePhoneVerifiedForRecentJoiner,
  component: MessagingLayout,
})

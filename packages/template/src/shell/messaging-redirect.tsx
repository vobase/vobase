/**
 * Legacy `/messaging` URL → `/inbox` redirect.
 *
 * The Inbox surface lives at `/inbox/*` per the dual-surface design. The
 * module backing it stays as `messaging` (the domain owns more than one
 * surface — pending approvals, internal notes, snooze state, etc.). This
 * route exists purely so old bookmarks and email links keep working.
 */

import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/messaging')({
  beforeLoad: () => {
    throw redirect({ to: '/inbox' })
  },
})

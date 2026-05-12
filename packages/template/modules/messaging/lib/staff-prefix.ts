/**
 * Shared `[<displayName>] <body>` prefix utilities for staff text replies.
 *
 * The prefix is the only per-row author signal on messages today — the
 * `messages` table has no `sender_id` column. Server-side `staff-reply.ts`
 * bakes it in via `prefixWithStaffName`; client-side `message-thread.tsx`
 * parses it back to resolve the rendered principal. Keeping both regexes in
 * one place prevents the producer and consumer from drifting.
 */

const STAFF_PREFIX_RE = /^\s*\[([^\]\n]+)\]/

export function hasStaffPrefix(body: string): boolean {
  return STAFF_PREFIX_RE.test(body)
}

export function extractStaffPrefix(body: string): string | null {
  const m = body.match(STAFF_PREFIX_RE)
  return m ? m[1].trim() : null
}

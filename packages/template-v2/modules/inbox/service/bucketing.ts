/**
 * Shared tab-bucketing function. Used by both the inbox list endpoint (SQL-side
 * filtering) and the frontend conversation list (client-side when the full
 * conversation set is already loaded).
 *
 * Three disjoint buckets:
 *   - `done`   — terminal-ish: `status ∈ {resolved, failed}`
 *   - `later`  — snoozed:      `snoozedUntil > now`
 *   - `active` — everything else (includes active, resolving, awaiting_approval)
 */

import type { Conversation } from '@server/contracts/domain-types'

export type InboxTab = 'active' | 'later' | 'done'

export function computeTab(c: Pick<Conversation, 'status' | 'snoozedUntil'>, now: Date): InboxTab {
  if (c.status === 'resolved' || c.status === 'failed') return 'done'
  if (c.snoozedUntil && new Date(c.snoozedUntil).getTime() > now.getTime()) return 'later'
  return 'active'
}

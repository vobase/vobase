/**
 * Staff-ping cooldown predicate (US-009 / Slice B.4).
 *
 * The automation dispatcher (US-013) calls `shouldSuppress` before invoking
 * `staffPing` to decide whether a fresh ping is allowed for a given
 * (staffUserId, conversationId, kind) tuple. The predicate is read-only — it
 * does NOT write to `pending_staff_pings` and it does NOT log a
 * `suppressed_cooldown` row to `automation_runs`. Those side effects are the
 * dispatcher's responsibility (see plan §3 + US-013).
 *
 * Window: 5 minutes per (staffUserId, conversationId, kind). A ping is
 * suppressed when there is at least one row in `pending_staff_pings` for the
 * same key with `created_at` inside the window. Cross-kind independence:
 * `(staff_a, conv_x, mention)` and `(staff_a, conv_x, approval)` are SEPARATE
 * keys — both can fire within the same minute. The 5-min suppression only
 * applies within a single kind.
 *
 * Follow-up bypass: `reason='followup'` bypasses the cooldown IFF a
 * soft-deleted (`claimed_at IS NOT NULL`) row exists for the same key within
 * the window. This lets the US-010 persistence-followup cron re-ping staff
 * who already replied without a decision. Without a soft-deleted prior, a
 * `followup` request still respects the cooldown — no infinite re-ping loop.
 */

import { getInstalledDb } from '@modules/integrations/service/registry'
import { pendingStaffPings } from '@modules/team/schema'
import { and, eq, gt, sql } from 'drizzle-orm'

/** 5-minute cooldown window. */
export const COOLDOWN_WINDOW_MS = 5 * 60 * 1000

export interface CooldownInput {
  staffUserId: string
  conversationId: string
  organizationId: string
  kind: 'mention' | 'approval' | 'proposal'
  reason?: 'followup'
}

/**
 * Optional DI hook for the predicate's DB handle. Default reads from
 * `getInstalledDb()` (set by `modules/integrations/module.ts::init`). Tests
 * pass an explicit handle to avoid relying on the module-init order.
 */
export interface ShouldSuppressDeps {
  db?: unknown
}

/**
 * Returns true when the dispatcher should NOT send a fresh ping for the
 * given key. See file header for the full predicate semantics.
 */
export async function shouldSuppress(input: CooldownInput, deps: ShouldSuppressDeps = {}): Promise<boolean> {
  const db = (deps.db ?? getInstalledDb()) as {
    select: (cols?: unknown) => {
      from: (t: unknown) => {
        where: (c: unknown) => Promise<Array<{ claimedAt: Date | null; createdAt: Date }>>
      }
    }
  }
  const cutoffIso = new Date(Date.now() - COOLDOWN_WINDOW_MS).toISOString()

  // Pull all rows for the (staff, conv, kind) key created inside the window.
  // We need both `claimed_at` and `created_at` to apply the followup-bypass —
  // the predicate is pure and the result-set is bounded (at most a handful of
  // rows per key per 5 min).
  const rows = await db
    .select({
      claimedAt: pendingStaffPings.claimedAt,
      createdAt: pendingStaffPings.createdAt,
    })
    .from(pendingStaffPings)
    .where(
      and(
        eq(pendingStaffPings.staffUserId, input.staffUserId),
        eq(pendingStaffPings.conversationId, input.conversationId),
        eq(pendingStaffPings.organizationId, input.organizationId),
        eq(pendingStaffPings.kind, input.kind),
        gt(pendingStaffPings.createdAt, sql`${cutoffIso}::timestamptz`),
      ),
    )

  if (rows.length === 0) return false

  if (input.reason === 'followup') {
    // Bypass only when a soft-deleted prior row exists within the window —
    // the staff replied (so the prior ping was claimed) but no decision came
    // through, and the followup cron is the second-attempt nudge. Without a
    // claimed prior, fall through to the normal cooldown semantics.
    const hasClaimedPrior = rows.some((r) => r.claimedAt !== null)
    if (hasClaimedPrior) return false
  }

  // Default: suppress when ANY row exists in the window — claimed-but-recent
  // counts because the staff already saw a ping for this exact event and a
  // duplicate would be spammy.
  return true
}

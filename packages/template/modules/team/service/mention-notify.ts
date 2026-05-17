/**
 * Verification-gating helper for the mention fan-out path (US-021).
 *
 * Given a set of staff user ids in a single org, partition them by the
 * better-auth `auth.user.phoneNumberVerified` flag so the mention fan-out can:
 *
 *   - send WhatsApp pings only to staff with verified phones (`verified[]`)
 *   - email-fallback any staff whose phone is NOT verified (`unverified[]`)
 *
 * The fan-out caller (`staff-ping.ts::fanOutNoteMentions`) holds the staff
 * mapping logic (online/prefs/no-profile checks) so this helper is intentionally
 * narrow: one join, one partition, no I/O beyond the SELECT.
 *
 * `phoneNumberVerified` is a NULLABLE column on `auth.user` (legacy rows pre-OTP
 * are NULL). NULL is treated as UNVERIFIED — the same default as the messaging
 * layout middleware (`modules/messaging/pages/layout.tsx`). Only `=== true`
 * counts as verified.
 *
 * Staff with no `auth.user` row at all (orphaned `staff_profiles`) are placed in
 * `unverified[]` so they still surface for email-fallback / skip accounting
 * rather than being silently dropped.
 */

import { authUser } from '@auth/schema'
import { staffProfiles } from '@modules/team/schema'
import { and, eq, inArray } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

export interface VerificationGatingResult {
  /** Staff user ids whose `auth.user.phoneNumberVerified === true`. Safe for WA-ping. */
  verified: string[]
  /** Staff user ids whose phone is unverified, NULL, or whose user row is missing. Email-fallback. */
  unverified: string[]
}

/**
 * Test seam — the team module installs a closure carrying `ctx.db`; tests can
 * swap the implementation with `installVerificationGating(...)` before the
 * fan-out runs. Falls back to a no-op partition (everything verified) when no
 * implementation is registered, which mirrors pre-US-021 behaviour.
 */
export type ApplyVerificationGatingFn = (
  staffIds: string[],
  organizationId: string,
) => Promise<VerificationGatingResult>

let _impl: ApplyVerificationGatingFn | null = null

export function installVerificationGating(fn: ApplyVerificationGatingFn): void {
  _impl = fn
}

export function __resetVerificationGatingForTests(): void {
  _impl = null
}

/**
 * Public entry. Routes through the installed implementation when present;
 * otherwise returns `{ verified: staffIds, unverified: [] }` so callers in
 * unit-test contexts without DB wiring keep their existing behaviour.
 */
export function applyVerificationGating(staffIds: string[], organizationId: string): Promise<VerificationGatingResult> {
  if (_impl) return _impl(staffIds, organizationId)
  return Promise.resolve({ verified: staffIds.slice(), unverified: [] })
}

/**
 * Production factory: returns the closure bound to a Drizzle handle. Wired in
 * `team/module.ts::init` so the helper sees the same `ScopedDb` everything else
 * in the team module uses.
 */
export function createVerificationGating(deps: { db: ScopedDb }): ApplyVerificationGatingFn {
  return async (staffIds: string[], organizationId: string): Promise<VerificationGatingResult> => {
    if (staffIds.length === 0) return { verified: [], unverified: [] }
    const rows = await deps.db
      .select({
        userId: staffProfiles.userId,
        phoneNumberVerified: authUser.phoneNumberVerified,
      })
      .from(staffProfiles)
      .innerJoin(authUser, eq(authUser.id, staffProfiles.userId))
      .where(and(eq(staffProfiles.organizationId, organizationId), inArray(staffProfiles.userId, staffIds)))

    const verified: string[] = []
    for (const row of rows) {
      if (row.phoneNumberVerified === true) verified.push(row.userId)
    }
    const verifiedSet = new Set(verified)
    const unverified = staffIds.filter((id) => !verifiedSet.has(id))
    return { verified, unverified }
  }
}

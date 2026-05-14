/**
 * Org enumerator for the `team:sync-staff-link:cron` job — returns the
 * organization ids that have at least one staff member with a populated phone
 * number (the better-auth `user.phone_number`). Pulled into its own module so
 * the jobs file (which may run inside a worker process without the full
 * module init) can import without dragging in the staff service singleton.
 */
/** @contract platform-tenant-v1 */

import { authUser } from '@auth/schema'
import { staffProfiles } from '@modules/team/schema'
import { eq, isNotNull } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

interface OrgEnumeratorDeps {
  db: ScopedDb
}

let _deps: OrgEnumeratorDeps | null = null

export function installTeamOrgEnumerator(deps: OrgEnumeratorDeps): void {
  _deps = deps
}

export function __resetTeamOrgEnumeratorForTests(): void {
  _deps = null
}

/**
 * Return distinct `organization_id`s with ≥1 staff member whose better-auth
 * `user.phone_number` is non-null. The daily cron fans out one reconcile per id.
 */
export async function listOrgsWithStaffPhones(): Promise<string[]> {
  if (!_deps) {
    // Boot-order tolerance: cron may fire before module init in test contexts.
    return []
  }
  const rows = (await _deps.db
    .selectDistinct({ organizationId: staffProfiles.organizationId })
    .from(staffProfiles)
    .innerJoin(authUser, eq(authUser.id, staffProfiles.userId))
    .where(isNotNull(authUser.phoneNumber))) as Array<{ organizationId: string }>
  // Stable ordering keeps cron logs comparable across runs.
  return rows.map((r) => r.organizationId).sort((a, b) => a.localeCompare(b))
}

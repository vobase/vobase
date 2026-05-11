/**
 * Org enumerator for the `team:sync-staff-link:cron` job — returns the
 * organization ids that have at least one staff profile with a populated
 * `whatsapp_phone_e164`. Pulled into its own module so the jobs file (which
 * may run inside a worker process without the full module init) can import
 * without dragging in the staff service singleton.
 */
/** @contract platform-tenant-v1 */

import { staffProfiles } from '@modules/team/schema'
import { isNotNull } from 'drizzle-orm'

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
 * Return distinct `organization_id`s with ≥1 staff row carrying a non-null
 * `whatsapp_phone_e164`. The daily cron fans out one reconcile per id.
 */
export async function listOrgsWithStaffPhones(): Promise<string[]> {
  if (!_deps) {
    // Boot-order tolerance: cron may fire before module init in test contexts.
    return []
  }
  const rows = (await _deps.db
    .selectDistinct({ organizationId: staffProfiles.organizationId })
    .from(staffProfiles)
    .where(isNotNull(staffProfiles.whatsappPhoneE164))) as Array<{ organizationId: string }>
  // Stable ordering keeps cron logs comparable across runs.
  return rows.map((r) => r.organizationId).sort((a, b) => a.localeCompare(b))
}

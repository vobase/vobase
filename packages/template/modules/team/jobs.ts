/**
 * team module jobs.
 *
 * `team:sync-staff-link` — pg-boss job that runs `syncStaffLinks(orgId)`. The
 * PATCH staff-phone handler enqueues this with `singletonKey: staff-link-sync:<orgId>`;
 * a daily cron also enqueues per org. Per §7.6 R9-E, retries 7 attempts over
 * ~24h horizon with exponential backoff so a platform 5xx eventually drains.
 *
 * `team:sync-staff-link:cron` — daily 03:00 UTC tick that enumerates orgs with
 * at least one staff member carrying a phone number (better-auth
 * `user.phone_number`) and fans out a deduped sync per org. Catch-all for
 * drift the PATCH path missed (deleted users, mid-flight 5xx that exhausted
 * retries, platform-side resets).
 */
/** @contract platform-tenant-v1 */

import type { JobDef } from '@vobase/core'

import {
  SYNC_STAFF_LINK_CRON_JOB,
  SYNC_STAFF_LINK_JOB,
  SYNC_STAFF_LINK_RETRY_LIMIT,
  syncStaffLinks,
  syncStaffLinksEnqueue,
} from './service/staff-link-sync'
import { listOrgsWithStaffPhones } from './service/staff-link-sync-orgs'

export interface SyncStaffLinkJobPayload {
  orgId: string
}

export interface SyncStaffLinkJobOptions {
  /**
   * Override the default org enumerator (default reads from `staff_profiles`).
   * The cron handler invokes this once per tick to fan out per-org sync.
   */
  listOrgs?: () => Promise<string[]>
}

/**
 * Build the team module's pg-boss job entries.
 *
 * Wrapped in a factory so the module init can inject a DB-bound org
 * enumerator for the cron tick. The reconciler handler itself reads no
 * deps from here — it resolves channel, staff, and platform creds at
 * execution time so the job payload stays narrow (just `orgId`).
 */
export function createTeamJobs(opts: SyncStaffLinkJobOptions = {}): JobDef[] {
  const listOrgs = opts.listOrgs ?? listOrgsWithStaffPhones
  return [
    {
      name: SYNC_STAFF_LINK_JOB,
      handler: async (data) => {
        const payload = data as SyncStaffLinkJobPayload
        await syncStaffLinks(payload.orgId)
      },
    },
    {
      name: SYNC_STAFF_LINK_CRON_JOB,
      handler: async () => {
        const orgs = await listOrgs()
        // Fan out via the same singleton-keyed enqueue the PATCH path uses
        // so a cron tick + concurrent PATCH burst still coalesces to one
        // in-flight reconcile per org per minute.
        for (const orgId of orgs) {
          await syncStaffLinksEnqueue(orgId)
        }
      },
    },
  ]
}

/** pg-boss send options for the per-org reconcile job (used by the scheduler binding). */
export const SYNC_STAFF_LINK_JOB_OPTIONS = {
  retryLimit: SYNC_STAFF_LINK_RETRY_LIMIT,
  retryBackoff: true,
  retryDelay: 60,
} as const

export { SYNC_STAFF_LINK_CRON_JOB, SYNC_STAFF_LINK_JOB } from './service/staff-link-sync'

/**
 * Static default export so existing collectors that read `team.jobs`
 * without the factory still see the bindings. The cron handler uses the
 * default DB-bound org enumerator; tests construct their own via
 * `createTeamJobs({ listOrgs })`.
 */
export const jobs: JobDef[] = createTeamJobs()

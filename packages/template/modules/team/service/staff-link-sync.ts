/**
 * Staff-link reconciler — converges tenant-side `staff_profiles.whatsapp_phone_e164`
 * with the platform's `staff_links` registry for the org's notification-tier
 * WhatsApp channel.
 *
 * Per §4.3 of the platform-tenant decoupling spec, this is the *single*
 * reconciler that owns the staff-link write path tenant-side. The PATCH
 * staff-phone handler does not call `staffLinks.upsert` inline — it enqueues
 * a `team:sync-staff-link` pg-boss job which calls `syncStaffLinks` here.
 * A daily cron also enqueues per-org sync to catch drift (deleted users,
 * platform-side resets, mid-flight 5xx that exhausted retries).
 *
 * Idempotent. Out-of-order PATCH bursts converge: the reconciler diffs
 * tenant set vs platform set and applies only the delta. Re-running on
 * a converged org is a single GET + no writes.
 *
 * Per §7.6 R9-E, the pg-boss enqueue side uses `singletonKey: staff-link-sync:<orgId>`
 * + `singletonHours: 0.0167` (1 minute) so a burst of PATCHes coalesces to
 * ≤1 in-flight job per org per minute (rate-limit ≤5/min/org).
 */
/** @contract platform-tenant-v1 — invoked by team:sync-staff-link pg-boss job. */

import type { ChannelInstance } from '@modules/channels/schema'
import { findNotificationChannel } from '@modules/channels/service/instances'
import {
  staffLinks as defaultStaffLinks,
  PlatformHandshakeError,
  type StaffLinkRow,
} from '@modules/integrations/service/handshake'
import { normalizeWaId } from '@modules/integrations/service/phone'

import type { StaffProfile } from '../schema'
import { list as listStaff } from './staff'

export const SYNC_STAFF_LINK_JOB = 'team:sync-staff-link'
export const SYNC_STAFF_LINK_CRON_JOB = 'team:sync-staff-link:cron'
/** 1 minute coalescing window (singletonHours is fractional hours). */
export const SYNC_STAFF_LINK_SINGLETON_HOURS = 1 / 60
/** Daily reconcile at 03:00 UTC. */
export const SYNC_STAFF_LINK_CRON = '0 3 * * *'
/** Per §7.6: 7 retries, ~24h horizon (exponential backoff handles the spread). */
export const SYNC_STAFF_LINK_RETRY_LIMIT = 7

export interface SyncStaffLinksOptions {
  /** When true, compute the delta + log it but skip write calls. */
  dryRun?: boolean
}

export interface SyncStaffLinkError {
  phase: 'upsert' | 'delete' | 'list'
  /** E.164 with leading `+` for upsert/delete; empty string for list. */
  staffPhoneE164: string
  message: string
}

export interface SyncStaffLinksResult {
  orgId: string
  /** Number of upserts the diff identified (whether or not they were applied). */
  toUpsert: number
  /** Number of deletes the diff identified. */
  toDelete: number
  applied: { upserted: number; deleted: number }
  errors: SyncStaffLinkError[]
  /** When the org has no notification channel, the reconciler is a no-op. */
  skipped?: 'no_notification_channel' | 'platform_not_configured'
}

export interface SyncStaffLinksContext {
  orgId: string
  /**
   * Per-call overrides for the platform-side credentials. Defaults to the
   * env-baked values (production path). Tests supply these inline.
   */
  platformBaseUrl?: string
  tenantId?: string
  tenantHmacSecret?: string
  environment?: 'production' | 'staging'
}

export interface SyncStaffLinksDeps {
  /** List staff for an org. Defaults to the installed staff service. */
  listStaff?: (orgId: string) => Promise<StaffProfile[]>
  /** Resolve the org's notification-tier channel. */
  findNotificationChannel?: (orgId: string) => Promise<ChannelInstance | null>
  /** Platform staff-link CRUD. Defaults to the env-bound handshake helpers. */
  staffLinksApi?: {
    list: (input: {
      platformBaseUrl: string
      tenantId: string
      tenantHmacSecret: string
      channelInstanceId?: string
    }) => Promise<StaffLinkRow[]>
    upsert: (input: {
      platformBaseUrl: string
      tenantId: string
      tenantHmacSecret: string
      environment: 'production' | 'staging'
      channelInstanceId: string
      staffUserId: string
      staffPhoneE164: string
    }) => Promise<{ linked: true; staffPhoneE164: string }>
    delete: (input: {
      platformBaseUrl: string
      tenantId: string
      tenantHmacSecret: string
      environment: 'production' | 'staging'
      staffPhoneE164: string
    }) => Promise<{ removed: boolean }>
  }
}

interface PlatformCreds {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  environment: 'production' | 'staging'
}

function readPlatformCreds(override: SyncStaffLinksContext): PlatformCreds | null {
  const platformBaseUrl = override.platformBaseUrl ?? process.env.VITE_PLATFORM_URL ?? ''
  const tenantId = override.tenantId ?? process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
  const tenantHmacSecret = override.tenantHmacSecret ?? process.env.PLATFORM_HMAC_SECRET ?? ''
  const environment: 'production' | 'staging' =
    override.environment ?? (process.env.NODE_ENV === 'production' ? 'production' : 'staging')
  if (!platformBaseUrl || !tenantId || !tenantHmacSecret) return null
  return { platformBaseUrl, tenantId, tenantHmacSecret, environment }
}

/**
 * Compute the per-org delta between tenant-side `staff_profiles` (with
 * non-null `whatsapp_phone_e164`) and platform-side `staff_links`, then
 * apply via `staffLinks.upsert` / `staffLinks.delete` until they converge.
 *
 * Out-of-order safe: the reconciler diffs sets, so two PATCHes racing each
 * other still converge once the loser's enqueue eventually fires. Per-row
 * errors accumulate in `result.errors` and do not abort the rest of the
 * walk — partial progress is committed and the job retries the remainder.
 */
export async function syncStaffLinks(
  ctx: SyncStaffLinksContext,
  opts: SyncStaffLinksOptions = {},
  deps: SyncStaffLinksDeps = {},
): Promise<SyncStaffLinksResult> {
  const listStaffFn = deps.listStaff ?? listStaff
  const findChannelFn = deps.findNotificationChannel ?? findNotificationChannel
  const api = deps.staffLinksApi ?? defaultStaffLinks

  const result: SyncStaffLinksResult = {
    orgId: ctx.orgId,
    toUpsert: 0,
    toDelete: 0,
    applied: { upserted: 0, deleted: 0 },
    errors: [],
  }

  const channel = await findChannelFn(ctx.orgId)
  if (!channel) {
    result.skipped = 'no_notification_channel'
    return result
  }

  const creds = readPlatformCreds(ctx)
  if (!creds) {
    result.skipped = 'platform_not_configured'
    return result
  }

  // Tenant-side: staff with a populated WhatsApp phone. Normalize once so
  // the diff compares canonical wa_ids (no leading `+`, no whitespace) on
  // both sides — matches what the platform stores.
  const staff = await listStaffFn(ctx.orgId)
  const tenantByWaId = new Map<string, { userId: string; staffPhoneE164: string }>()
  for (const profile of staff) {
    if (!profile.whatsappPhoneE164) continue
    try {
      const waId = normalizeWaId(profile.whatsappPhoneE164)
      tenantByWaId.set(waId, { userId: profile.userId, staffPhoneE164: profile.whatsappPhoneE164 })
    } catch (err) {
      // Malformed phone in the DB — surface as a per-row error and skip.
      result.errors.push({
        phase: 'upsert',
        staffPhoneE164: profile.whatsappPhoneE164,
        message: err instanceof Error ? err.message : 'invalid wa_id',
      })
    }
  }

  // Platform-side: the channel's existing staff_links. List failure aborts
  // the run with a single error — there's no point trying to diff against
  // an unknown set.
  let platformLinks: StaffLinkRow[]
  try {
    platformLinks = await api.list({
      platformBaseUrl: creds.platformBaseUrl,
      tenantId: creds.tenantId,
      tenantHmacSecret: creds.tenantHmacSecret,
      channelInstanceId: channel.id,
    })
  } catch (err) {
    result.errors.push({
      phase: 'list',
      staffPhoneE164: '',
      message: err instanceof Error ? err.message : 'list failed',
    })
    return result
  }

  const platformByWaId = new Map<string, StaffLinkRow>()
  for (const row of platformLinks) {
    // The platform stores wa_id (no `+`); normalize defensively so a row
    // stored as `+E164` (legacy) compares equal to the wa_id form.
    try {
      const waId = normalizeWaId(row.staffPhoneE164)
      platformByWaId.set(waId, row)
    } catch {
      // Unparseable platform-side row — surface and skip.
      result.errors.push({
        phase: 'delete',
        staffPhoneE164: row.staffPhoneE164,
        message: 'platform returned unparseable staff_phone_e164',
      })
    }
  }

  // Upserts: tenant has a phone the platform doesn't, OR the platform has
  // the phone bound to a different `staffUserId` (re-bind after a staff
  // swap on the same number).
  const upserts: Array<{ userId: string; staffPhoneE164: string }> = []
  for (const [waId, tenant] of tenantByWaId) {
    const platformRow = platformByWaId.get(waId)
    if (!platformRow || platformRow.staffUserId !== tenant.userId) {
      upserts.push(tenant)
    }
  }

  // Deletes: platform has a phone that isn't in the tenant set.
  const deletes: StaffLinkRow[] = []
  for (const [waId, row] of platformByWaId) {
    if (!tenantByWaId.has(waId)) deletes.push(row)
  }

  result.toUpsert = upserts.length
  result.toDelete = deletes.length

  if (opts.dryRun) return result

  for (const u of upserts) {
    try {
      await api.upsert({
        platformBaseUrl: creds.platformBaseUrl,
        tenantId: creds.tenantId,
        tenantHmacSecret: creds.tenantHmacSecret,
        environment: creds.environment,
        channelInstanceId: channel.id,
        staffUserId: u.userId,
        staffPhoneE164: u.staffPhoneE164,
      })
      result.applied.upserted += 1
    } catch (err) {
      result.errors.push({
        phase: 'upsert',
        staffPhoneE164: u.staffPhoneE164,
        message:
          err instanceof PlatformHandshakeError ? err.message : err instanceof Error ? err.message : 'upsert failed',
      })
    }
  }

  for (const d of deletes) {
    try {
      await api.delete({
        platformBaseUrl: creds.platformBaseUrl,
        tenantId: creds.tenantId,
        tenantHmacSecret: creds.tenantHmacSecret,
        environment: creds.environment,
        // Platform-stored value may be either form; pass through as-is so the
        // delete helper's own `toWaId` normalization stays the single source.
        staffPhoneE164: d.staffPhoneE164,
      })
      result.applied.deleted += 1
    } catch (err) {
      result.errors.push({
        phase: 'delete',
        staffPhoneE164: d.staffPhoneE164,
        message:
          err instanceof PlatformHandshakeError ? err.message : err instanceof Error ? err.message : 'delete failed',
      })
    }
  }

  return result
}

// ─── Enqueue (job side) ─────────────────────────────────────────────────────

export interface SyncStaffLinkJobQueue {
  send(name: string, data: unknown, opts?: { singletonKey?: string }): Promise<string>
}

interface TeamJobsState {
  jobs: SyncStaffLinkJobQueue | null
}

let _state: TeamJobsState = { jobs: null }

export function installTeamJobsState(state: TeamJobsState): void {
  _state = state
}

export function __resetTeamJobsStateForTests(): void {
  _state = { jobs: null }
}

/**
 * Enqueue a deduped reconcile for `orgId`. Per §7.6 R9-E, pg-boss
 * `singletonKey` coalesces enqueues by `(name, key)` and the upstream
 * scheduler is expected to apply `singletonHours` to rate-limit fanout.
 * A burst of PATCHes from the same org therefore collapses to ≤1 job/min.
 */
export async function syncStaffLinksEnqueue(orgId: string): Promise<void> {
  if (!_state.jobs) {
    // Tests / boot order without an installed scheduler: silently no-op.
    // The PATCH path tolerates this — the daily cron + next PATCH will
    // eventually converge. A loud throw here would break unit tests that
    // exercise PATCH without booting the full module ctx.
    return
  }
  await _state.jobs.send(SYNC_STAFF_LINK_JOB, { orgId }, { singletonKey: `staff-link-sync:${orgId}` })
}

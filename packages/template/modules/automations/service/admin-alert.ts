/**
 * Admin alert dispatcher (US-012a / Slice C+).
 *
 * `dispatchAdminAlert(input)` sends an admin-tier alert to org admins about a
 * tenant-wide event (today: only `budget_breach` from the budget watcher; the
 * `kind` is an open enum so future categories — invoice failure, integration
 * disconnect, etc. — can join).
 *
 * **1-hour dedup** on `(kind, dedupKey)`: the caller computes a stable
 * `dedupKey` (e.g. `budget_breach:<orgId>:<UTC-day-string>`). If a prior
 * succeeded alert with the same key landed in `automations.automation_runs`
 * within 60 minutes, the second invocation:
 *   - writes a fresh `automation_runs(status='suppressed_cooldown')` row with
 *     `payload_snapshot.reason='admin_alert_dedup'` so the operator dashboard
 *     surfaces the suppression;
 *   - returns `{status: 'suppressed_cooldown'}` without sending.
 *
 * **Send path** (US-012a): for each org admin with a phoneNumber, fires
 * `sendNotificationTemplate` with the `vobase_admin_alert` template (or
 * `vobase_tenant_notification` fallback). Mints a magic-link POST-COMMIT
 * (Principle 6). On `MagicLinkMintError` → writes
 * `automation_runs(status='failed', errorMessage='magic_link_mint_failed')`
 * and returns `{status: 'failed', reason: 'magic_link_mint_failed'}`.
 *
 * **Recipient resolution**: `auth.member` joined to `auth.user` filtered by
 * `organizationId` and `role = 'owner'`. Only members with a `phoneNumber` can
 * receive a WhatsApp notification — others are silently skipped. When no
 * reachable recipient exists, the run succeeds with
 * `payloadSnapshot.reason='no_admin_recipients'`.
 *
 * The auditable `automation_runs` write is the durable signal. The
 * `admin-alert.ts` path is in `AUTOMATION_RUNS_WRITE_ALLOWED` — no new
 * allowlist entries are required (see `scripts/check-module-shape.ts:73-84`).
 */

import { MagicLinkMintError, mintMagicLink } from '@auth/magic-link'
import { authMember, authUser } from '@auth/schema'
import { automationRuns } from '@modules/automations/schema'
import { findNotificationChannel } from '@modules/channels/service/instances'
import { COST_ESTIMATE_USD, type WireRoute } from '@modules/integrations/service/handshake'
import { redirectPathFor } from '@modules/integrations/service/notification-template-payloads'
import {
  buildRedirectRefs,
  buildTemplateForDispatch,
  type SendTemplateFn,
  urlToSuffix,
} from '@modules/team/service/staff-ping'
import { logger } from '@vobase/core'
import { and, desc, eq, gt, sql } from 'drizzle-orm'

import type { Auth } from '~/auth'
import type { ScopedDb } from '~/runtime'

/** Stable event name used for every admin-alert run row — keeps dedup queries cheap. */
export const ADMIN_ALERT_EVENT_NAME = 'budget_watcher.admin_alert'

/** Synthetic rule id used when persisting the run row — there is no real
 * `automations` rule row backing the admin-alert path, so we use a sentinel
 * recognisable from dashboard queries. */
export const ADMIN_ALERT_SENTINEL_RULE_ID = 'system:admin-alert'

export type AdminAlertKind = 'budget_breach' | 'other'

export interface AdminAlertInput {
  orgId: string
  /** Category — used for dedup key. Open enum for future categories. */
  kind: AdminAlertKind
  /** Short headline for the WA template body (≤120 chars). */
  alertHeadline: string
  /** Detail text for the WA template body (≤200 chars). */
  alertDetail: string
  /** Organization display name — included in the template body. */
  organizationName: string
  /** Stable hash for dedup — caller computes from kind+specific-payload (e.g. `budget_breach:<orgId>:<day>`). */
  dedupKey: string
}

export type AdminAlertResult =
  | { status: 'sent'; alertId: string }
  | { status: 'suppressed_cooldown'; alertId: string }
  | { status: 'failed'; alertId: string; reason: 'magic_link_mint_failed' | 'no_admin_recipients' }

interface AdminAlertDeps {
  db: ScopedDb
  /**
   * Template-send seam — same closure installed by module init for the dispatcher.
   * When absent (dev without platform), WA send is skipped and the run is still
   * recorded as succeeded (log-only fallback).
   */
  sendTemplate?: SendTemplateFn
  /**
   * better-auth instance for `mintMagicLink`. Required for real magic-link minting.
   * When absent (dev without platform), mint is skipped and a bare-path suffix is used.
   */
  auth?: Auth | null
  /**
   * Platform tenant id from `PLATFORM_TENANT_ID` env. Required for `mintMagicLink`.
   * When absent, mint is skipped.
   */
  tenantId?: string | null
}

let _installedDeps: AdminAlertDeps | null = null

export function installAdminAlertDeps(deps: AdminAlertDeps): void {
  _installedDeps = deps
}

export function __resetAdminAlertForTests(): void {
  _installedDeps = null
}

function getDeps(): AdminAlertDeps {
  if (!_installedDeps) {
    throw new Error('admin-alert: deps not installed (call installAdminAlertDeps at boot)')
  }
  return _installedDeps
}

/**
 * Override the dedup-window in tests. Defaults to 1 hour.
 */
const DEDUP_WINDOW_MS = 60 * 60 * 1000

interface DispatchOpts {
  /** Override clock — tests pin to a deterministic now. */
  now?: Date
  /** Override DB handle (defaults to the one installed by module init). */
  db?: ScopedDb
}

interface OrgAdminRecipient {
  userId: string
  email: string
  phoneNumber: string
}

/** Resolve org admin members who have a phone number set (reachable via WA). */
async function resolveOrgAdmins(db: ScopedDb, orgId: string): Promise<OrgAdminRecipient[]> {
  try {
    const rows = await db
      .select({
        userId: authMember.userId,
        email: authUser.email,
        phoneNumber: authUser.phoneNumber,
      })
      .from(authMember)
      .innerJoin(authUser, eq(authUser.id, authMember.userId))
      .where(and(eq(authMember.organizationId, orgId), eq(authMember.role, 'owner')))
    return rows.filter((r): r is OrgAdminRecipient => typeof r.phoneNumber === 'string' && r.phoneNumber.length > 0)
  } catch (err) {
    logger.warn({ err, orgId }, '[automations/admin-alert] resolveOrgAdmins failed — falling back to empty list')
    return []
  }
}

/**
 * Dispatch an admin alert with 1-hour `(kind, dedupKey)` dedup.
 */
export async function dispatchAdminAlert(input: AdminAlertInput, opts: DispatchOpts = {}): Promise<AdminAlertResult> {
  const deps = getDeps()
  const db = opts.db ?? deps.db
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - DEDUP_WINDOW_MS)

  /**
   * Production index recommendation: the dedup query below uses
   *   payload_snapshot ->> 'dedupKey' = $key
   * which is a sequential scan today. For tenants with >10k automation_runs/day,
   * add (manually, per tenant DB):
   *
   *   CREATE INDEX CONCURRENTLY idx_automation_runs_admin_dedup
   *     ON automations.automation_runs ((payload_snapshot ->> 'dedupKey'), event_name)
   *     WHERE status = 'succeeded';
   *
   * Not landed in core schema today because admin_alert volume is low (one per
   * orgId per day per breach) — sequential scan over a single day's runs is fine.
   */
  // Look for a prior succeeded alert with the same dedupKey within the window.
  const priors = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.eventName, ADMIN_ALERT_EVENT_NAME),
        eq(automationRuns.organizationId, input.orgId),
        eq(automationRuns.status, 'succeeded'),
        gt(automationRuns.startedAt, cutoff),
        sql`payload_snapshot->>'dedupKey' = ${input.dedupKey}`,
      ),
    )
    .orderBy(desc(automationRuns.startedAt))
    .limit(1)

  if (priors.length > 0) {
    // Record the suppression so the operator dashboard reflects it.
    const finishedAt = new Date()
    const inserted = await db
      .insert(automationRuns)
      .values({
        ruleId: ADMIN_ALERT_SENTINEL_RULE_ID,
        organizationId: input.orgId,
        eventName: ADMIN_ALERT_EVENT_NAME,
        status: 'suppressed_cooldown',
        startedAt: now,
        finishedAt,
        durationMs: finishedAt.getTime() - now.getTime(),
        payloadSnapshot: {
          kind: input.kind,
          dedupKey: input.dedupKey,
          reason: 'admin_alert_dedup',
          priorAlertId: priors[0]?.id ?? null,
        },
      })
      .returning({ id: automationRuns.id })
    const alertId = inserted[0]?.id
    if (!alertId) throw new Error('admin-alert: suppression INSERT returned no row')
    logger.warn(
      { orgId: input.orgId, kind: input.kind, dedupKey: input.dedupKey, alertId, priorAlertId: priors[0]?.id },
      '[automations/admin-alert] suppressed_cooldown — duplicate within 1h window',
    )
    return { status: 'suppressed_cooldown', alertId }
  }

  // ── Send path (US-012a) ──────────────────────────────────────────────────────
  // Resolve admin recipients — org members with role='owner' and a phoneNumber.
  const recipients = await resolveOrgAdmins(db, input.orgId)

  if (recipients.length === 0) {
    logger.warn(
      { orgId: input.orgId, kind: input.kind, dedupKey: input.dedupKey },
      '[automations/admin-alert] no reachable admin recipients — recording succeeded with reason',
    )
    const finishedAt = new Date()
    const inserted = await db
      .insert(automationRuns)
      .values({
        ruleId: ADMIN_ALERT_SENTINEL_RULE_ID,
        organizationId: input.orgId,
        eventName: ADMIN_ALERT_EVENT_NAME,
        status: 'succeeded',
        startedAt: now,
        finishedAt,
        durationMs: finishedAt.getTime() - now.getTime(),
        payloadSnapshot: {
          kind: input.kind,
          dedupKey: input.dedupKey,
          alertHeadline: input.alertHeadline,
          alertDetail: input.alertDetail,
          organizationName: input.organizationName,
          reason: 'no_admin_recipients',
        },
      })
      .returning({ id: automationRuns.id })
    const alertId = inserted[0]?.id
    if (!alertId) throw new Error('admin-alert: no-recipients INSERT returned no row')
    return { status: 'failed', alertId, reason: 'no_admin_recipients' }
  }

  // Attempt to send WA notifications to each admin recipient.
  const { sendTemplate, auth, tenantId } = deps

  // Read metaTemplateApprovals from the notification channel config.
  let metaTemplateApprovals: Record<string, unknown> | null = null
  try {
    const channel = await findNotificationChannel(input.orgId)
    if (channel?.config?.metaTemplateApprovals != null && typeof channel.config.metaTemplateApprovals === 'object') {
      metaTemplateApprovals = channel.config.metaTemplateApprovals as Record<string, unknown>
    }
  } catch (err) {
    logger.warn(
      { err, orgId: input.orgId },
      '[automations/admin-alert] findNotificationChannel failed — using fallback template',
    )
  }

  const { templateName, bodyParams } = buildTemplateForDispatch(
    'admin_alert',
    {
      alertHeadline: input.alertHeadline,
      alertDetail: input.alertDetail,
      organizationName: input.organizationName,
    },
    metaTemplateApprovals,
  )

  // Tracks the wire route used on the last successful send; written into payloadSnapshot.
  let lastWireRoute: WireRoute | undefined

  // Mint and send for each recipient. MagicLinkMintError on the FIRST recipient
  // aborts the entire send and records a failed run (the error is per-call, not
  // per-platform, so if mint is broken it will be broken for all recipients).
  try {
    for (const recipient of recipients) {
      let buttonUrlSuffix: string
      if (auth && tenantId) {
        const refs = buildRedirectRefs('admin_alert', { conversationId: null, referenceId: input.dedupKey })
        const redirectPath = redirectPathFor(refs)
        // MagicLinkMintError propagates up — caught below.
        const mintResult = await mintMagicLink(auth, db, {
          userId: recipient.userId,
          email: recipient.email,
          tenantId,
          organizationId: input.orgId,
          redirectPath,
        })
        buttonUrlSuffix = urlToSuffix(mintResult.url)
      } else {
        // Dev/test fallback: no platform configured — use bare system activity path.
        buttonUrlSuffix = 'system/activity'
      }

      if (sendTemplate) {
        try {
          const sendResult = await sendTemplate({
            organizationId: input.orgId,
            staffPhoneE164: recipient.phoneNumber,
            templateName,
            bodyParams,
            buttonUrlSuffix,
          })
          lastWireRoute = sendResult.wireRoute
          logger.info(
            {
              orgId: input.orgId,
              kind: input.kind,
              userId: recipient.userId,
              templateName,
              wireRoute: sendResult.wireRoute,
            },
            '[automations/admin-alert] WA notification sent',
          )
        } catch (err) {
          // Non-fatal send error — log and continue to next recipient.
          logger.warn(
            { err, orgId: input.orgId, userId: recipient.userId, templateName },
            '[automations/admin-alert] WA send failed (non-fatal — continuing to next recipient)',
          )
        }
      } else {
        // Platform not configured — log-only fallback.
        logger.warn(
          {
            orgId: input.orgId,
            kind: input.kind,
            dedupKey: input.dedupKey,
            alertHeadline: input.alertHeadline,
            alertDetail: input.alertDetail,
            userId: recipient.userId,
            slice: 'no-platform',
          },
          '[automations/admin-alert] dispatch (sendTemplate not configured — log-only)',
        )
      }
    }
  } catch (err) {
    if (err instanceof MagicLinkMintError) {
      // admin-alert.ts is in AUTOMATION_RUNS_WRITE_ALLOWED — write failure row directly.
      const finishedAt = new Date()
      const inserted = await db
        .insert(automationRuns)
        .values({
          ruleId: ADMIN_ALERT_SENTINEL_RULE_ID,
          organizationId: input.orgId,
          eventName: ADMIN_ALERT_EVENT_NAME,
          status: 'failed',
          errorMessage: 'magic_link_mint_failed',
          startedAt: now,
          finishedAt,
          durationMs: finishedAt.getTime() - now.getTime(),
          payloadSnapshot: {
            kind: input.kind,
            dedupKey: input.dedupKey,
            alertHeadline: input.alertHeadline,
            alertDetail: input.alertDetail,
            organizationName: input.organizationName,
            cause: String((err as MagicLinkMintError).cause ?? err),
          },
        })
        .returning({ id: automationRuns.id })
      const alertId = inserted[0]?.id
      if (!alertId) throw new Error('admin-alert: mint-failure INSERT returned no row')
      logger.warn(
        {
          orgId: input.orgId,
          kind: input.kind,
          dedupKey: input.dedupKey,
          alertId,
          cause: String((err as MagicLinkMintError).cause),
        },
        '[automations/admin-alert] magic_link_mint_failed',
      )
      return { status: 'failed', alertId, reason: 'magic_link_mint_failed' }
    }
    // Other errors bubble up.
    throw err
  }

  const finishedAt = new Date()
  const inserted = await db
    .insert(automationRuns)
    .values({
      ruleId: ADMIN_ALERT_SENTINEL_RULE_ID,
      organizationId: input.orgId,
      eventName: ADMIN_ALERT_EVENT_NAME,
      status: 'succeeded',
      startedAt: now,
      finishedAt,
      durationMs: finishedAt.getTime() - now.getTime(),
      payloadSnapshot: {
        kind: input.kind,
        dedupKey: input.dedupKey,
        alertHeadline: input.alertHeadline,
        alertDetail: input.alertDetail,
        organizationName: input.organizationName,
        recipientCount: recipients.length,
        wireRoute: lastWireRoute ?? null,
        costEstimateUsd: lastWireRoute != null ? COST_ESTIMATE_USD[lastWireRoute] : null,
      },
    })
    .returning({ id: automationRuns.id })
  const alertId = inserted[0]?.id
  if (!alertId) throw new Error('admin-alert: send INSERT returned no row')
  return { status: 'sent', alertId }
}

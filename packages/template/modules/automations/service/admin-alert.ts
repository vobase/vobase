/**
 * Admin-tier alert dispatcher — sends a WhatsApp notification to org owners about
 * tenant-wide events (currently: `budget_breach`; open enum for future categories).
 *
 * Deduplication: 1-hour window on `(kind, dedupKey)`. Suppressed runs are recorded
 * as `status='suppressed_cooldown'` so the operator dashboard surfaces them.
 *
 * Recipients: `auth.member` (role='owner') joined to `auth.user` filtered by
 * `phoneNumber`. Members without a phone are silently skipped.
 */

import { MagicLinkMintError, mintMagicLink } from '@auth/magic-link'
import { getMagicLinkEndpointId } from '@auth/magic-link-endpoint-config'
import { authMember, authUser } from '@auth/schema'
import { automationRuns } from '@modules/automations/schema'
import { getNotificationSettings } from '@modules/channels/service/notification-settings'
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

export const ADMIN_ALERT_EVENT_NAME = 'budget_watcher.admin_alert'

/** Sentinel used in place of a real automation rule id for admin-alert run rows. */
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
          reason: 'no_admin_recipients',
        },
      })
      .returning({ id: automationRuns.id })
    const alertId = inserted[0]?.id
    if (!alertId) throw new Error('admin-alert: no-recipients INSERT returned no row')
    return { status: 'failed', alertId, reason: 'no_admin_recipients' }
  }

  // Attempt to send WA notifications to each admin recipient.
  const { sendTemplate, auth } = deps

  // Read metaTemplateApprovals from notification_settings.
  let metaTemplateApprovals: Record<string, unknown> | null = null
  try {
    const settings = await getNotificationSettings(db, input.orgId)
    if (settings?.metaTemplateApprovals != null) {
      metaTemplateApprovals = settings.metaTemplateApprovals
    }
  } catch (err) {
    logger.warn(
      { err, orgId: input.orgId },
      '[automations/admin-alert] getNotificationSettings failed — using fallback template',
    )
  }

  const { templateName, bodyParams } = buildTemplateForDispatch(
    'admin_alert',
    {
      alertHeadline: input.alertHeadline,
      alertDetail: input.alertDetail,
    },
    metaTemplateApprovals,
  )

  let lastWireRoute: WireRoute | undefined

  // MagicLinkMintError on any recipient aborts the entire send — mint failures are
  // per-platform, not per-recipient, so if it's broken it's broken for everyone.
  try {
    for (const recipient of recipients) {
      let buttonUrlSuffix: string
      if (auth) {
        const refs = buildRedirectRefs('admin_alert', { conversationId: null, referenceId: input.dedupKey })
        const redirectPath = redirectPathFor(refs)
        const endpointId = await getMagicLinkEndpointId(db, input.orgId)
        const mintResult = await mintMagicLink(auth, db, {
          userId: recipient.userId,
          email: recipient.email,
          endpointId,
          organizationId: input.orgId,
          redirectPath,
        })
        buttonUrlSuffix = urlToSuffix(mintResult.url)
      } else {
        // Dev/test fallback: no platform configured — use bare automations dashboard path.
        buttonUrlSuffix = 'automations'
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

/**
 * Admin alert dispatcher (US-015 / Slice D.3).
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
 * **Send path** is intentionally minimal in Slice D.3 — Slice C (US-011/12)
 * will introduce a `vobase_admin_alert` Meta template + a typed recipient
 * resolver. Until then:
 *   - sourcing org-admin recipients (the `auth_member` / `auth_organization`
 *     join) is **deferred**; the alert body is emitted via `logger.warn` with
 *     a `[automations/admin-alert]` prefix so operators can grep for it in
 *     prod logs;
 *   - the run row is still recorded with `status='succeeded'` so dedup works
 *     end-to-end.
 *
 * The auditable `automation_runs` write is the durable signal; the log line is
 * the operator-visible fallback until Slice C wires the WhatsApp template.
 */

import { automationRuns } from '@modules/automations/schema'
import { logger } from '@vobase/core'
import { and, desc, eq, gt, sql } from 'drizzle-orm'

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
  /** Pre-rendered body the WA recipient sees. Caller assembles it from breach data. */
  bodyText: string
  /** Stable hash for dedup — caller computes from kind+specific-payload (e.g. `budget_breach:<orgId>:<day>`). */
  dedupKey: string
}

export type AdminAlertResult = { status: 'sent'; alertId: string } | { status: 'suppressed_cooldown'; alertId: string }

interface AdminAlertDeps {
  db: ScopedDb
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

/**
 * Dispatch an admin alert with 1-hour `(kind, dedupKey)` dedup.
 */
export async function dispatchAdminAlert(input: AdminAlertInput, opts: DispatchOpts = {}): Promise<AdminAlertResult> {
  const db = opts.db ?? getDeps().db
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - DEDUP_WINDOW_MS)

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

  // Send path: Slice C will plug in the vobase_admin_alert template +
  // org-admin recipient lookup. Until then, fall through to a structured log
  // and mark the run succeeded so dedup engages on the next call.
  logger.warn(
    {
      orgId: input.orgId,
      kind: input.kind,
      dedupKey: input.dedupKey,
      bodyText: input.bodyText,
      slice: 'C-deferred',
    },
    '[automations/admin-alert] dispatch (channels-less fallback — Slice C wires WhatsApp template)',
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
        bodyText: input.bodyText,
      },
    })
    .returning({ id: automationRuns.id })
  const alertId = inserted[0]?.id
  if (!alertId) throw new Error('admin-alert: send INSERT returned no row')
  return { status: 'sent', alertId }
}

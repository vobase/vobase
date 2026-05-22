/**
 * Typed notification-template-payloads.
 *
 * Single in-code reference for all three Meta WhatsApp templates submitted
 * under the Vobase WABA. Operators can use the table below when creating /
 * modifying templates in the Meta Business dashboard.
 *
 * All templates: LANGUAGE=en, CATEGORY=UTILITY, HEADER=none.
 *
 * ## Template 1 — `vobase_inbox_mention_v2`
 *
 * | Field   | Value                                                                                                              |
 * |---------|--------------------------------------------------------------------------------------------------------------------|
 * | NAME    | `vobase_inbox_mention_v2`                                                                                          |
 * | BODY    | `New mention from _{{1}}_:\n\n*{{2}}*\n\nFrom the conversation inbox.`                                              |
 * | FOOTER  | `Reply to instruct the agent.`                                                                                     |
 * | BUTTONS | URL button — text: `Open chat`, url: `https://platform.vobase.dev/{{1}}`. Suffix {{1}} = `auth/magic?token=<token>&redirect=/inbox/<contactId>` (percent-encoded). |
 *
 * Body params: 1=agentName, 2=snippet.
 *
 * ## Template 2 — `vobase_decision_required_v2`
 *
 * | Field   | Value                                                                                                              |
 * |---------|--------------------------------------------------------------------------------------------------------------------|
 * | NAME    | `vobase_decision_required_v2`                                                                                      |
 * | BODY    | `Decision needed for *{{1}}*.\n\n_{{2}}_\n\nFiled by _{{3}}_ on your behalf.`                                       |
 * | FOOTER  | `Reply to instruct the agent.`                                                                                     |
 * | BUTTONS | URL button — text: `Review request`, url: `https://platform.vobase.dev/{{1}}`. Suffix {{1}} = `auth/magic?token=<token>&redirect=<redirectPath>&...` (percent-encoded). |
 *
 * Body params: 1=summary (≤80 chars), 2=detail (≤200 chars), 3=agentName (≤80 chars).
 * Used by both `approval` and `proposal` ping kinds — the per-kind redirect
 * path (set via `redirectPathFor`) decides which review page the magic link
 * lands on.
 *
 * ## Template 3 — `vobase_admin_alert_v2`
 *
 * | Field   | Value                                                                                                              |
 * |---------|--------------------------------------------------------------------------------------------------------------------|
 * | NAME    | `vobase_admin_alert_v2`                                                                                            |
 * | BODY    | `Admin alert: *{{1}}*\n\n_{{2}}_\n\nTriggered by automation.`                                                       |
 * | FOOTER  | `Reply to instruct the agent.`                                                                                     |
 * | BUTTONS | URL button — text: `View details`, url: `https://platform.vobase.dev/{{1}}`. Suffix {{1}} = `auth/magic?token=<token>&redirect=/automations` (percent-encoded). |
 *
 * Body params: 1=alertHeadline (≤120 chars), 2=alertDetail (≤200 chars).
 */

import { validation } from '@vobase/core'
import { z } from 'zod'

export const NOTIFICATION_TEMPLATES = [
  'vobase_inbox_mention_v2',
  'vobase_decision_required_v2',
  'vobase_admin_alert_v2',
] as const

export type NotificationTemplateName = (typeof NOTIFICATION_TEMPLATES)[number]

const trimmedString = (max: number) => z.string().min(1).max(max)

export const InboxMentionBody = z.object({
  agentName: trimmedString(80),
  snippet: trimmedString(200),
})
export type InboxMentionBody = z.infer<typeof InboxMentionBody>

export const DecisionRequiredBody = z.object({
  agentName: trimmedString(80),
  summary: trimmedString(80),
  detail: trimmedString(200),
})
export type DecisionRequiredBody = z.infer<typeof DecisionRequiredBody>

export const AdminAlertBody = z.object({
  alertHeadline: trimmedString(120),
  alertDetail: trimmedString(200),
})
export type AdminAlertBody = z.infer<typeof AdminAlertBody>

export const BODY_SCHEMAS = {
  vobase_inbox_mention_v2: InboxMentionBody,
  vobase_decision_required_v2: DecisionRequiredBody,
  vobase_admin_alert_v2: AdminAlertBody,
} satisfies Record<NotificationTemplateName, z.ZodType<unknown>>

// ─── Redirect path builder ───────────────────────────────────────────────────

/**
 * Per-kind redirect-path builder. Pure function of (kind, refs) — no Date.now,
 * no env reads — keeps the magic-link minting call site deterministic.
 */
/**
 * The conversation-detail route is `/inbox/$contactId` (keyed by CONTACT id —
 * see `modules/messaging/pages/$contactId.tsx`). All three
 * conversation-scoped kinds therefore deep-link to `/inbox/<contactId>`;
 * pending approvals/proposals render inline in that thread. There is no nested
 * `/inbox/<x>/approvals/<id>` or `/proposals/<id>` route. No query strings —
 * `auth/magic-finish.ts` `SAFE_REDIRECT_RE` rejects `?`/`=`.
 */
export type RedirectRefs =
  | { kind: 'mention'; contactId: string }
  | { kind: 'approval'; contactId: string }
  | { kind: 'proposal'; contactId: string }
  | { kind: 'admin_alert' }

export function redirectPathFor(refs: RedirectRefs): string {
  switch (refs.kind) {
    case 'mention':
    case 'approval':
    case 'proposal':
      return refs.contactId ? `/inbox/${refs.contactId}` : '/inbox'
    case 'admin_alert':
      return '/automations'
  }
}

// ─── Per-kind template selector ──────────────────────────────────────────────

/** Per-kind template selector. Single switch — the staff-ping per-kind selector reads from this. */
export function templateNameFor(kind: 'mention' | 'approval' | 'proposal' | 'admin_alert'): NotificationTemplateName {
  switch (kind) {
    case 'mention':
      return 'vobase_inbox_mention_v2'
    case 'approval':
      return 'vobase_decision_required_v2'
    case 'proposal':
      return 'vobase_decision_required_v2'
    case 'admin_alert':
      return 'vobase_admin_alert_v2'
  }
}

// ─── Wire-shape mapper ───────────────────────────────────────────────────────

function assertNever(_: never): never {
  throw new Error(`notification-template-payloads: unhandled template name`)
}

/**
 * Maps a validated typed body to the positional `bodyParams` array in template-declared order.
 * The positional array is what the Meta Cloud API / platform endpoint expects.
 */
export function bodyParamsForWire(templateName: NotificationTemplateName, body: unknown): readonly string[] {
  switch (templateName) {
    case 'vobase_inbox_mention_v2': {
      const b = body as InboxMentionBody
      return [b.agentName, b.snippet]
    }
    case 'vobase_decision_required_v2': {
      const b = body as DecisionRequiredBody
      return [b.summary, b.detail, b.agentName]
    }
    case 'vobase_admin_alert_v2': {
      const b = body as AdminAlertBody
      return [b.alertHeadline, b.alertDetail]
    }
    default:
      return assertNever(templateName)
  }
}

// ─── Free-form text renderer ─────────────────────────────────────────────────

/**
 * Renders a notification template as a plain-text string suitable for free-form
 * WhatsApp body rendering (e.g. non-template messages, fallback channels).
 *
 * Validates `bodyParams` via `BODY_SCHEMAS[templateName].safeParse`; throws
 * `VobaseError` (VALIDATION) on mismatch, mirroring `sendNotificationTemplate`.
 */
export function renderTemplateAsText(
  templateName: NotificationTemplateName,
  bodyParams: unknown,
  buttonUrl: string,
): string {
  const parseResult = BODY_SCHEMAS[templateName].safeParse(bodyParams)
  if (!parseResult.success) {
    throw validation(
      parseResult.error.flatten(),
      `renderTemplateAsText: invalid bodyParams for template '${templateName}'`,
    )
  }

  switch (templateName) {
    case 'vobase_inbox_mention_v2': {
      const b = parseResult.data as InboxMentionBody
      return `New mention from _${b.agentName}_:\n\n*${b.snippet}*\n\nFrom the conversation inbox.\n\nReply to instruct the agent.\n\nOpen: ${buttonUrl}`
    }
    case 'vobase_decision_required_v2': {
      const b = parseResult.data as DecisionRequiredBody
      return `Decision needed for *${b.summary}*.\n\n_${b.detail}_\n\nFiled by _${b.agentName}_ on your behalf.\n\nReply to instruct the agent.\n\nOpen: ${buttonUrl}`
    }
    case 'vobase_admin_alert_v2': {
      const b = parseResult.data as AdminAlertBody
      return `Admin alert: *${b.alertHeadline}*\n\n_${b.alertDetail}_\n\nTriggered by automation.\n\nReply to instruct the agent.\n\nOpen: ${buttonUrl}`
    }
    default:
      return assertNever(templateName)
  }
}

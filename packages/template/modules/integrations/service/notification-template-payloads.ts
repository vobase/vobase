/**
 * Typed notification-template-payloads.
 *
 * Single in-code reference for all four Meta WhatsApp templates submitted
 * under the Vobase WABA. Operators can use the table below when creating /
 * modifying templates in the Meta Business dashboard.
 *
 * All templates: LANGUAGE=en, CATEGORY=UTILITY, HEADER=none.
 *
 * ## Template 1 — `vobase_tenant_notification` (modified)
 *
 * | Field   | Value                                                                                                              |
 * |---------|--------------------------------------------------------------------------------------------------------------------|
 * | NAME    | `vobase_tenant_notification`                                                                                       |
 * | BODY    | `*{{1}}* mentioned you in a conversation.\n\n_{{2}}_\n\nYour agent: {{3}}`                                        |
 * | FOOTER  | `Tap below to open the conversation in Vobase.`                                                                    |
 * | BUTTONS | URL button — text: `Open conversation`, url: `https://platform.voltade.app/{{1}}`. Suffix {{1}} = `auth/magic?token=<token>&redirect=/inbox/<conversationId>` (percent-encoded). |
 *
 * Body params: 1=mentionerName, 2=snippet (≤200 chars), 3=agentName.
 *
 * ## Template 2 — `vobase_approval_decision` (new)
 *
 * | Field   | Value                                                                                                              |
 * |---------|--------------------------------------------------------------------------------------------------------------------|
 * | NAME    | `vobase_approval_decision`                                                                                         |
 * | BODY    | `{{1}} filed an approval request.\n\n*{{2}}*\n\n_{{3}}_\n\nTap below to review and decide.`                      |
 * | FOOTER  | `Pending approval — your decision needed.`                                                                         |
 * | BUTTONS | URL button — text: `Review approval`, url: `https://platform.voltade.app/{{1}}`. Suffix {{1}} = `auth/magic?token=<token>&redirect=/inbox/<conversationId>/approvals/<approvalId>` (percent-encoded). |
 *
 * Body params: 1=agentName, 2=approvalSummary (≤80 chars), 3=approvalContext (≤200 chars).
 *
 * ## Template 3 — `vobase_proposal_decision` (new)
 *
 * | Field   | Value                                                                                                              |
 * |---------|--------------------------------------------------------------------------------------------------------------------|
 * | NAME    | `vobase_proposal_decision`                                                                                         |
 * | BODY    | `{{1}} proposed a change to {{2}}.\n\n*{{3}}*\n\nTap below to review and decide.`                                |
 * | FOOTER  | `Pending change proposal — your decision needed.`                                                                  |
 * | BUTTONS | URL button — text: `Review proposal`, url: `https://platform.voltade.app/{{1}}`. Suffix {{1}} = `auth/magic?token=<token>&redirect=/inbox/<conversationId>/proposals/<proposalId>` (percent-encoded). |
 *
 * Body params: 1=agentName, 2=resourceLabel (e.g. `contacts/profile-field`, ≤60 chars), 3=proposalSummary (≤200 chars).
 *
 * ## Template 4 — `vobase_admin_alert` (new)
 *
 * | Field   | Value                                                                                                              |
 * |---------|--------------------------------------------------------------------------------------------------------------------|
 * | NAME    | `vobase_admin_alert`                                                                                               |
 * | BODY    | `*Vobase admin alert*\n\n{{1}}\n\n_{{2}}_\n\nOrganization: {{3}}`                                                |
 * | FOOTER  | `Open the activity dashboard to investigate.`                                                                      |
 * | BUTTONS | URL button — text: `Open activity dashboard`, url: `https://platform.voltade.app/{{1}}`. Suffix {{1}} = `auth/magic?token=<token>&redirect=/automations` (percent-encoded). |
 *
 * Body params: 1=alertHeadline (≤120 chars), 2=alertDetail (≤200 chars), 3=organizationName (≤80 chars).
 */

import { validation } from '@vobase/core'
import { z } from 'zod'

export const NOTIFICATION_TEMPLATES = [
  'vobase_tenant_notification',
  'vobase_approval_decision',
  'vobase_proposal_decision',
  'vobase_admin_alert',
] as const

export type NotificationTemplateName = (typeof NOTIFICATION_TEMPLATES)[number]

const trimmedString = (max: number) => z.string().min(1).max(max)

export const TenantNotificationBody = z.object({
  mentionerName: trimmedString(80),
  snippet: trimmedString(200),
  agentName: trimmedString(80),
})
export type TenantNotificationBody = z.infer<typeof TenantNotificationBody>

export const ApprovalDecisionBody = z.object({
  agentName: trimmedString(80),
  approvalSummary: trimmedString(80),
  approvalContext: trimmedString(200),
})
export type ApprovalDecisionBody = z.infer<typeof ApprovalDecisionBody>

export const ProposalDecisionBody = z.object({
  agentName: trimmedString(80),
  resourceLabel: trimmedString(60),
  proposalSummary: trimmedString(200),
})
export type ProposalDecisionBody = z.infer<typeof ProposalDecisionBody>

export const AdminAlertBody = z.object({
  alertHeadline: trimmedString(120),
  alertDetail: trimmedString(200),
  organizationName: trimmedString(80),
})
export type AdminAlertBody = z.infer<typeof AdminAlertBody>

export const BODY_SCHEMAS = {
  vobase_tenant_notification: TenantNotificationBody,
  vobase_approval_decision: ApprovalDecisionBody,
  vobase_proposal_decision: ProposalDecisionBody,
  vobase_admin_alert: AdminAlertBody,
} satisfies Record<NotificationTemplateName, z.ZodType<unknown>>

// ─── Redirect path builder ───────────────────────────────────────────────────

/**
 * Per-kind redirect-path builder. Pure function of (kind, refs) — no Date.now,
 * no env reads — keeps the magic-link minting call site deterministic.
 */
export type RedirectRefs =
  | { kind: 'mention'; conversationId: string }
  | { kind: 'approval'; conversationId: string; approvalId: string }
  | { kind: 'proposal'; conversationId: string; proposalId: string }
  | { kind: 'admin_alert' }

export function redirectPathFor(refs: RedirectRefs): string {
  switch (refs.kind) {
    case 'mention':
      return `/inbox/${refs.conversationId}`
    case 'approval':
      return `/inbox/${refs.conversationId}/approvals/${refs.approvalId}`
    case 'proposal':
      return `/inbox/${refs.conversationId}/proposals/${refs.proposalId}`
    case 'admin_alert':
      return '/automations'
  }
}

// ─── Per-kind template selector ──────────────────────────────────────────────

/** Per-kind template selector. Single switch — the staff-ping per-kind selector reads from this. */
export function templateNameFor(kind: 'mention' | 'approval' | 'proposal' | 'admin_alert'): NotificationTemplateName {
  switch (kind) {
    case 'mention':
      return 'vobase_tenant_notification'
    case 'approval':
      return 'vobase_approval_decision'
    case 'proposal':
      return 'vobase_proposal_decision'
    case 'admin_alert':
      return 'vobase_admin_alert'
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
    case 'vobase_tenant_notification': {
      const b = body as TenantNotificationBody
      return [b.mentionerName, b.snippet, b.agentName]
    }
    case 'vobase_approval_decision': {
      const b = body as ApprovalDecisionBody
      return [b.agentName, b.approvalSummary, b.approvalContext]
    }
    case 'vobase_proposal_decision': {
      const b = body as ProposalDecisionBody
      return [b.agentName, b.resourceLabel, b.proposalSummary]
    }
    case 'vobase_admin_alert': {
      const b = body as AdminAlertBody
      return [b.alertHeadline, b.alertDetail, b.organizationName]
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
    case 'vobase_tenant_notification': {
      const b = parseResult.data as TenantNotificationBody
      return `*${b.mentionerName}* mentioned you in a conversation.\n\n_${b.snippet}_\n\nYour agent: ${b.agentName}\n\nTap below to open the conversation in Vobase.\n\nOpen: ${buttonUrl}`
    }
    case 'vobase_approval_decision': {
      const b = parseResult.data as ApprovalDecisionBody
      return `${b.agentName} filed an approval request.\n\n*${b.approvalSummary}*\n\n_${b.approvalContext}_\n\nTap below to review and decide.\n\nPending approval — your decision needed.\n\nOpen: ${buttonUrl}`
    }
    case 'vobase_proposal_decision': {
      const b = parseResult.data as ProposalDecisionBody
      return `${b.agentName} proposed a change to ${b.resourceLabel}.\n\n*${b.proposalSummary}*\n\nTap below to review and decide.\n\nPending change proposal — your decision needed.\n\nOpen: ${buttonUrl}`
    }
    case 'vobase_admin_alert': {
      const b = parseResult.data as AdminAlertBody
      return `*Vobase admin alert*\n\n${b.alertHeadline}\n\n_${b.alertDetail}_\n\nOrganization: ${b.organizationName}\n\nOpen the activity dashboard to investigate.\n\nOpen: ${buttonUrl}`
    }
    default:
      return assertNever(templateName)
  }
}

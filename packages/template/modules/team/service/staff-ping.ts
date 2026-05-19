/**
 * Staff ping primitive: dispatches a WhatsApp notification to a staff user
 * about a conversation event they need to be aware of.
 *
 * Four kinds (US-009 / Slice B.4 / US-011b):
 *   - 'mention'    — staff is @-mentioned in an internal note (the original kind)
 *   - 'approval'   — staff needs to decide on a pending approval (Slice B.3 emit('approval_filed'))
 *   - 'proposal'   — staff needs to decide on a change proposal (Slice B.3 emit('proposal_filed'))
 *   - 'admin_alert' — admin-tier alert (US-015 / Slice D.3)
 *
 * Per-kind template selector (US-011b): `templateNameFor(kind)` from
 * `notification-template-payloads.ts` picks the right Meta template name. The
 * dispatcher gates on `channel_instances.config.metaTemplateApprovals` before
 * calling `sendTemplate` and falls back to `vobase_inbox_mention_v2` when
 * the per-kind template is unapproved (see `buildTemplateForDispatch`).
 *
 * Magic-link minting (US-011b / Principle 6): `mintMagicLink` is called
 * POST-COMMIT inside the notification path — never inside a producer's
 * `db.transaction(...)` block. The platform base URL is stripped from the mint
 * result to produce the `buttonUrlSuffix` the Meta template expects.
 *
 * The existing mention fan-out APIs (`fanOutNoteMentions`, `enqueueMentionFanOut`,
 * `createMentionNotifyService`) are preserved for back-compat with
 * `messaging/handlers/notes.ts` + `messaging/tools/consult-staff.ts`.
 */

import { MagicLinkMintError, mintMagicLink } from '@auth/magic-link'
import { authUser as authUserTable } from '@auth/schema'
import { agentDefinitions } from '@modules/agents/schema'
import { decideChangeProposal } from '@modules/changes/service/proposals'
import { findNotificationChannel } from '@modules/channels/service/instances'
import { PlatformHandshakeError } from '@modules/integrations/service/handshake'
import {
  type DecisionRequiredBody,
  type InboxMentionBody,
  type NotificationTemplateName,
  type RedirectRefs,
  redirectPathFor,
  templateNameFor,
} from '@modules/integrations/service/notification-template-payloads'
import type { InternalNote } from '@modules/messaging/schema'
import {
  type NotificationSuppressionReason,
  recordNotificationSent,
  recordNotificationSuppressed,
} from '@modules/messaging/service/notification-events'
import { decide as decideApproval } from '@modules/messaging/service/pending-approvals'
import { getPrefs } from '@modules/settings/service/notification-prefs'
import { applyVerificationGating } from '@modules/team/service/mention-notify'
import { recordPing } from '@modules/team/service/pending-staff-pings'
import { find as findStaff } from '@modules/team/service/staff'
import { logger, type ScopedScheduler } from '@vobase/core'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { Auth } from '~/auth'
import type { ScopedDb, Tx } from '~/runtime'
import { PRESENCE_THRESHOLD_MS } from '~/runtime/presence'
import type { StaffProfile } from '../schema'

// ─── Generalized multi-kind primitive (US-009 / Slice B.4) ───────────────────

export type PingKind = 'mention' | 'approval' | 'proposal' | 'admin_alert'

export interface StaffPingParams {
  conversationId: string | null
  organizationId: string
  staffUserId: string
  /**
   * Reference into pending_approvals or change_proposals row, depending on kind.
   * For 'mention', this is the noteId. For 'admin_alert', this is a sentinel id.
   */
  referenceId: string
  /** Pre-rendered body the staff WA receives — caller builds it from the upstream payload. */
  bodyText: string
  /** Sender label shown in the WA message ("Bob in #helpdesk", "Helpdesk Agent", etc). */
  senderLabel: string
  /** Set on follow-up re-pings so cooldown can bypass when a prior ping was claimed. */
  reason?: 'followup'
  /** Optional asking-agent id; defaults to a sentinel for non-mention kinds. */
  askingAgentId?: string
  // Per-kind structured params for template body building (US-011b).
  // For 'mention': agentName + snippet come from the fan-out path.
  // For 'approval' / 'proposal': agentName + summary + detail (merged decision-required template).
  summary?: string
  detail?: string
  // For 'admin_alert': alertHeadline + alertDetail + organizationName.
  alertHeadline?: string
  alertDetail?: string
  organizationName?: string
  // For the per-kind redirect path builder.
  approvalId?: string
  proposalId?: string
}

export type StaffPingResult =
  | { status: 'sent'; pingId: string }
  | { status: 'suppressed_cooldown' }
  | { status: 'suppressed_unverified' }

/**
 * Generic staff-ping primitive — used by the US-013 automations dispatcher
 * and the existing mention fan-out (which still goes through
 * `fanOutNoteMentions` for the per-staff prefs/online/no-phone checks).
 *
 * Per-kind template selector (US-011b): reads `templateNameFor(kind)` and gates
 * on `channel_instances.config.metaTemplateApprovals` via `buildTemplateForDispatch`.
 *
 * Records the ping in `pending_staff_pings` (sole writer, see US-007) so a
 * later staff reply can be claimed back via the two-rung ladder.
 *
 * Cooldown (see `modules/automations/service/cooldown.ts`) is enforced by
 * the caller before invoking this — `staffPing` does not re-check.
 *
 * US-021: returns `{ status: 'suppressed_unverified' }` when the target staff
 * user's `auth.user.phoneNumberVerified !== true`. The dispatcher records this
 * as `automation_runs(status='suppressed_unverified')` and skips the WA send.
 * NULL `phoneNumberVerified` (legacy rows pre-OTP) is treated as unverified,
 * matching the messaging layout middleware convention.
 */
export async function staffPing(kind: PingKind, params: StaffPingParams, ctx: { tx: Tx }): Promise<StaffPingResult> {
  // US-021: gate before any side-effects. Returns suppressed_unverified when
  // `auth.user.phoneNumberVerified !== true` (NULL = unverified).
  const gating = await applyVerificationGating([params.staffUserId], params.organizationId)
  if (gating.unverified.includes(params.staffUserId)) {
    // Surface the suppression to the conversation timeline so customers see
    // *why* a ping didn't fire. `admin_alert` has no conversationId — skip
    // silently in that branch (the alert is conversation-less).
    if (params.conversationId) {
      const displayName = await resolveStaffDisplayName(params.staffUserId)
      await recordNotificationSuppressed(
        {
          conversationId: params.conversationId,
          organizationId: params.organizationId,
          kind,
          channel: 'whatsapp',
          recipientStaffId: params.staffUserId,
          recipientDisplayName: displayName,
          suppressionReason: 'unverified',
        },
        ctx.tx,
      )
    }
    return { status: 'suppressed_unverified' }
  }

  const askingAgentId = params.askingAgentId ?? 'agent:pending'
  const convId = params.conversationId ?? ''
  await recordPing({
    conversationId: convId,
    staffUserId: params.staffUserId,
    organizationId: params.organizationId,
    askingAgentId,
    originalNoteId: params.referenceId,
    kind: kind === 'admin_alert' ? 'mention' : kind,
    referenceId: kind === 'mention' || kind === 'admin_alert' ? null : params.referenceId,
  })
  void params.bodyText
  void params.senderLabel
  return { status: 'sent', pingId: `${convId}:${params.staffUserId}` }
}

/**
 * Snapshot the staff display name at notification time so the timeline survives
 * later renames / removals. Falls back to the userId if the staff row can't
 * be loaded.
 */
export async function resolveStaffDisplayName(staffUserId: string): Promise<string> {
  try {
    const profile = await findStaff(staffUserId)
    return profile?.displayName ?? staffUserId
  } catch {
    return staffUserId
  }
}

/**
 * Convenience for the mention fan-out's per-staff suppression sites — wraps
 * `recordNotificationSuppressed` with the shared `kind: 'mention'` + `channel:
 * 'whatsapp'` defaults so the call sites stay terse.
 */
function emitMentionSuppressed(
  note: MentionFanOutNote,
  recipientStaffId: string,
  recipientDisplayName: string,
  suppressionReason: NotificationSuppressionReason,
): Promise<void> {
  return recordNotificationSuppressed({
    conversationId: note.conversationId,
    organizationId: note.organizationId,
    kind: 'mention',
    channel: 'whatsapp',
    recipientStaffId,
    recipientDisplayName,
    suppressionReason,
  })
}

// ─── Reply routing (US-009 / Slice B.4) ──────────────────────────────────────

export type ReplyDecision = 'approve' | 'deny' | 'unknown'

export interface ReplyOutcome {
  status: 'routed'
  kind: PingKind
  referenceId: string
  decision: ReplyDecision
  /** Free-text portion of the reply (after the verb), or the entire reply if unknown. */
  note?: string
}

/**
 * Parse the staff WhatsApp reply and route it.
 *
 * - 'mention' → wake-only (no decision; staff replied = ack, wake the asking agent).
 *               The actual wake is done by the inbound router's existing
 *               `addNote` post-commit fan-out — this function is a no-op for
 *               'mention' beyond returning the outcome shape.
 * - 'approval' → call `pendingApprovals.decide(approvalId, decision)` — the
 *                decide path already emits `approval_decided` (US-008), so
 *                the wake chain fires automatically.
 * - 'proposal' → call `proposals.decideChangeProposal(proposalId, decision)`
 *                — same automatic wake chain via `proposal_decided`.
 *
 * Decision-enum mapping: WA-side uses `'approve' | 'deny'`; the persistence
 * services use `'approved' | 'rejected'`. The mapping is fixed here to keep
 * the call sites terse.
 */
export async function resolveReply(
  kind: PingKind,
  payload: { decision: ReplyDecision; note?: string; referenceId: string },
  claim: { staffUserId: string; conversationId: string; organizationId: string },
): Promise<ReplyOutcome> {
  void claim.conversationId
  void claim.organizationId
  const outcome: ReplyOutcome = {
    status: 'routed',
    kind,
    referenceId: payload.referenceId,
    decision: payload.decision,
    ...(payload.note ? { note: payload.note } : {}),
  }

  if (kind === 'mention' || kind === 'admin_alert') return outcome

  if (payload.decision === 'unknown') {
    return outcome
  }

  const mappedDecision: 'approved' | 'rejected' = payload.decision === 'approve' ? 'approved' : 'rejected'
  if (kind === 'approval') {
    await decideApproval(payload.referenceId, {
      decision: mappedDecision,
      decidedByUserId: claim.staffUserId,
      ...(payload.note ? { note: payload.note } : {}),
    })
  } else {
    await decideChangeProposal(payload.referenceId, mappedDecision, claim.staffUserId, payload.note)
  }
  return outcome
}

// ─── Existing mention fan-out (preserved verbatim from mention-notify.ts) ────

/** pg-boss job that runs the mention fan-out off the request path (see file header). */
export const FANOUT_MENTION_PINGS_JOB = 'team:fanout-mention-pings'

/**
 * The slice of `InternalNote` the fan-out actually consumes. The job payload
 * carries only these fields — it keeps the queue row small and avoids shipping
 * `createdAt`, a `Date` that would deserialize back as a string after the
 * JSON round-trip and lie about its type.
 */
const MentionFanOutNoteSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  conversationId: z.string(),
  authorType: z.enum(['agent', 'staff', 'system']),
  authorId: z.string(),
  body: z.string(),
  mentions: z.array(z.string()),
})
export type MentionFanOutNote = z.infer<typeof MentionFanOutNoteSchema>

/** Payload for {@link FANOUT_MENTION_PINGS_JOB}. Zod-parsed at the job-handler boundary. */
export const FanOutMentionPingsPayloadSchema = z.object({ note: MentionFanOutNoteSchema })
export type FanOutMentionPingsPayload = z.infer<typeof FanOutMentionPingsPayloadSchema>

/**
 * Test seam: send a notification template to a staff phone.
 * Production wires the real `sendNotificationTemplate` closure with platform
 * creds resolved once at boot; tests pass a stub so they don't have to mock
 * global fetch + platform env.
 */
export type SendTemplateFn = (input: {
  organizationId: string
  staffPhoneE164: string
  templateName: NotificationTemplateName
  bodyParams: unknown // typed body matching BODY_SCHEMAS[templateName]
  buttonUrlSuffix: string
}) => Promise<{ ok: true; messageId: string | null; wireRoute: 'freeform' | 'template' | 'freeform_fallback_template' }>

/**
 * Platform base URL used to strip the prefix from a mint result URL and produce
 * the `buttonUrlSuffix` Meta expects.
 * e.g. `https://platform.vobase.dev/auth/magic?...` → `auth/magic?...`
 */
const PLATFORM_BASE_URL = 'https://platform.vobase.dev/'

/**
 * Strip the platform base prefix from a full mint URL to get the button URL suffix.
 * Throws if the URL doesn't start with the expected base (misconfiguration guard).
 *
 * If `PLATFORM_TENANT_ID` is not set (dev/test without platform), the caller
 * skips mint entirely and this function is not called.
 */
export function urlToSuffix(url: string): string {
  if (!url.startsWith(PLATFORM_BASE_URL)) {
    throw new Error(
      `urlToSuffix: URL does not start with platform base '${PLATFORM_BASE_URL}' — got '${url.slice(0, 80)}'`,
    )
  }
  return url.slice(PLATFORM_BASE_URL.length)
}

/**
 * Build the `RedirectRefs` argument for `redirectPathFor` from a kind + ping params.
 * Used by the mention fan-out (where params are different) AND by `staffPing`.
 */
export function buildRedirectRefs(
  kind: PingKind,
  refs: { conversationId: string | null; referenceId: string; approvalId?: string; proposalId?: string },
): RedirectRefs {
  const convId = refs.conversationId ?? ''
  switch (kind) {
    case 'mention':
      return { kind: 'mention', conversationId: convId }
    case 'approval':
      return { kind: 'approval', conversationId: convId, approvalId: refs.approvalId ?? refs.referenceId }
    case 'proposal':
      return { kind: 'proposal', conversationId: convId, proposalId: refs.proposalId ?? refs.referenceId }
    case 'admin_alert':
      return { kind: 'admin_alert' }
  }
}

/**
 * Build the typed body params for a given kind.
 * For 'mention', the body is built from fan-out params (agentName/snippet).
 * For other kinds, it reads from the StaffPingParams structured fields.
 */
function buildBodyParams(
  kind: PingKind,
  params: {
    snippet?: string
    agentName?: string
    summary?: string
    detail?: string
    alertHeadline?: string
    alertDetail?: string
    organizationName?: string
  },
): InboxMentionBody | DecisionRequiredBody | { alertHeadline: string; alertDetail: string; organizationName: string } {
  switch (kind) {
    case 'mention':
      return {
        agentName: params.agentName ?? 'your agent',
        snippet: params.snippet ?? '',
      }
    case 'approval':
    case 'proposal':
      return {
        agentName: params.agentName ?? 'your agent',
        summary: params.summary ?? '',
        detail: params.detail ?? '',
      }
    case 'admin_alert':
      return {
        alertHeadline: params.alertHeadline ?? '',
        alertDetail: params.alertDetail ?? '',
        organizationName: params.organizationName ?? '',
      }
  }
}

/**
 * Fallback body: pack the kind-specific summary into the `vobase_inbox_mention_v2`
 * 2-tuple when the per-kind template is unapproved. Preserves agentName verbatim;
 * truncates the summary to ≤200 chars if needed.
 */
function buildFallbackBody(
  kind: PingKind,
  params: {
    snippet?: string
    agentName?: string
    summary?: string
    detail?: string
    alertHeadline?: string
    alertDetail?: string
    organizationName?: string
  },
): InboxMentionBody {
  const agentName = params.agentName ?? 'your agent'
  let snippet: string
  switch (kind) {
    case 'mention':
      snippet = params.snippet ?? ''
      break
    case 'approval':
    case 'proposal':
      snippet = params.summary ?? params.detail ?? ''
      break
    case 'admin_alert':
      snippet = params.alertHeadline ?? params.alertDetail ?? ''
      break
  }
  const truncated = snippet.length > 200 ? `${snippet.slice(0, 197)}…` : snippet
  return { agentName, snippet: truncated }
}

/**
 * Read the `metaTemplateApprovals` jsonb from the notification channel instance config
 * and decide whether to use the per-kind template or fall back to `vobase_inbox_mention_v2`.
 *
 * The `channel_instances.config.metaTemplateApprovals` field is a JSONB record keyed by
 * template name → `'approved' | 'pending' | 'rejected'`. Operators populate it manually
 * via Drizzle Studio after Meta approves each template. Missing keys are treated as
 * unapproved (fallback is the DEFAULT — per-kind sends only when explicitly 'approved').
 *
 * Returns `{ templateName, bodyParams }` ready for `sendTemplate`.
 */
export function buildTemplateForDispatch(
  kind: PingKind,
  params: {
    snippet?: string
    agentName?: string
    summary?: string
    detail?: string
    alertHeadline?: string
    alertDetail?: string
    organizationName?: string
  },
  metaTemplateApprovals: Record<string, unknown> | null | undefined,
): { templateName: NotificationTemplateName; bodyParams: unknown } {
  const perKindTemplate = templateNameFor(kind)
  const isApproved = metaTemplateApprovals != null && metaTemplateApprovals[perKindTemplate] === 'approved'

  if (isApproved) {
    return { templateName: perKindTemplate, bodyParams: buildBodyParams(kind, params) }
  }
  // Fallback: re-render to vobase_inbox_mention_v2 3-tuple.
  return { templateName: 'vobase_inbox_mention_v2', bodyParams: buildFallbackBody(kind, params) }
}

/**
 * Email-fallback seam used by the mention fan-out for staff whose phone is
 * not OTP-verified (US-021). The team module wires this to a real email
 * adapter at boot when one is configured; tests inject a stub so the unit/
 * integration suites can count fallback fires without touching live SMTP.
 *
 * The signature is intentionally narrow — no full email template machinery is
 * declared in core today. When a proper EmailAdapter contract lands, the
 * implementation can route through it without changing this seam.
 */
export type SendEmailFallbackFn = (input: {
  organizationId: string
  staffUserId: string
  conversationId: string
  noteId: string
  body: string
}) => Promise<{ ok: true } | { ok: false; reason: string }>

interface MentionNotifyDeps {
  db: unknown
  /** pg-boss queue for the durable fan-out enqueue. Omitted in unit-test contexts — `enqueueFanOut` then no-ops. */
  jobs?: Pick<ScopedScheduler, 'send'> | null
  /** Template-send seam. Omitted in unit-test contexts — `sendNotification` returns `platform_not_configured`. */
  sendTemplate?: SendTemplateFn
  /**
   * Email-fallback seam (US-021). When omitted, unverified-staff fan-out still
   * surfaces `reason: 'phone_unverified'` in `result.skipped` but no email is
   * sent — the dev/test default when no email adapter is configured.
   */
  sendEmailFallback?: SendEmailFallbackFn
  /**
   * better-auth instance for `mintMagicLink`. Omitted when `PLATFORM_TENANT_ID` is not set
   * (dev/test without platform) — the magic-link mint is skipped and the legacy
   * tenant-slug buttonUrlSuffix is used as fallback.
   */
  auth?: Auth | null
  /**
   * Resolved platform tenant id — baked into the service closure at boot from
   * `PLATFORM_TENANT_ID` env. When absent, mint is skipped (dev-without-platform fallback).
   */
  tenantId?: string | null
}

export interface FanOutResult {
  notified: string[]
  skipped: Array<{ userId: string; reason: string }>
}

export interface MentionNotifyService {
  /** Worker side — does the WhatsApp I/O + ping-ledger write. Invoked by the team job handler. */
  fanOutNoteMentions(note: MentionFanOutNote): Promise<FanOutResult>
  /** Producer side — durably enqueues the fan-out as a pg-boss job. */
  enqueueFanOut(note: InternalNote): Promise<void>
}

function parseStaffMention(raw: string): string | null {
  return raw.startsWith('staff:') ? raw.slice('staff:'.length) : null
}

function isOffline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return true
  return Date.now() - new Date(lastSeenAt).getTime() > PRESENCE_THRESHOLD_MS
}

function trimSnippet(body: string): string {
  return body.length > 200 ? `${body.slice(0, 197)}…` : body
}

interface DrizzleAgentSelect {
  select: (fields?: unknown) => {
    from: (t: unknown) => {
      where: (c: unknown) => { limit: (n: number) => Promise<Array<{ name: string }>> }
    }
  }
}

/**
 * Look up a staff user's email from the `auth_user` table.
 * `StaffProfile` doesn't carry `email` — it's only on the better-auth user row.
 * Returns null when the user doesn't exist (defensive; mintMagicLink also pre-flights this).
 */
async function resolveUserEmail(db: unknown, userId: string): Promise<{ email: string } | null> {
  try {
    const rows = await (db as ScopedDb)
      .select({ email: authUserTable.email })
      .from(authUserTable)
      .where(eq(authUserTable.id, userId))
      .limit(1)
    const row = rows[0]
    if (!row?.email) return null
    return { email: row.email }
  } catch {
    return null
  }
}

async function resolveAgentName(db: unknown, agentId: string): Promise<string> {
  try {
    const rows = await (db as DrizzleAgentSelect)
      .select({ name: agentDefinitions.name })
      .from(agentDefinitions)
      .where(eq(agentDefinitions.id, agentId))
      .limit(1)
    return rows[0]?.name ?? 'your agent'
  } catch {
    return 'your agent'
  }
}

export function createMentionNotifyService(deps: MentionNotifyDeps): MentionNotifyService {
  const jobs = deps.jobs ?? null
  const sendTemplate = deps.sendTemplate ?? null
  const sendEmailFallback = deps.sendEmailFallback ?? null
  const auth = deps.auth ?? null
  const tenantId = deps.tenantId ?? null

  async function sendNotification(
    organizationId: string,
    profile: StaffProfile,
    kind: 'mention',
    params: {
      snippet: string
      agentName: string
      conversationId: string
    },
  ): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }>
  async function sendNotification(
    organizationId: string,
    profile: StaffProfile,
    kind: PingKind,
    params: {
      snippet?: string
      agentName?: string
      conversationId?: string | null
      summary?: string
      detail?: string
      alertHeadline?: string
      alertDetail?: string
      organizationName?: string
      approvalId?: string
      proposalId?: string
      referenceId?: string
    },
  ): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }>

  async function sendNotification(
    organizationId: string,
    profile: StaffProfile,
    kind: PingKind,
    params: {
      snippet?: string
      agentName?: string
      conversationId?: string | null
      summary?: string
      detail?: string
      alertHeadline?: string
      alertDetail?: string
      organizationName?: string
      approvalId?: string
      proposalId?: string
      referenceId?: string
    },
  ): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }> {
    const channel = await findNotificationChannel(organizationId)
    if (!channel) return { ok: false, reason: 'no_notification_channel' }
    if (!profile.phoneNumber) return { ok: false, reason: 'no_whatsapp_phone' }
    if (!sendTemplate) return { ok: false, reason: 'platform_not_configured' }

    // Read metaTemplateApprovals from channel config. Operators populate this
    // manually via Drizzle Studio after Meta approves each template. Missing = unapproved.
    const metaTemplateApprovals =
      typeof channel.config?.metaTemplateApprovals === 'object' && channel.config.metaTemplateApprovals !== null
        ? (channel.config.metaTemplateApprovals as Record<string, unknown>)
        : null

    const { templateName, bodyParams } = buildTemplateForDispatch(kind, params, metaTemplateApprovals)

    // Determine the button URL suffix via magic-link mint (Principle 6: post-commit only).
    // If `tenantId` or `auth` is not configured (dev/test without platform), skip mint
    // and fall back to the legacy tenant-slug deep-link.
    let buttonUrlSuffix: string
    if (auth && tenantId && profile.userId) {
      // Resolve email from authUser — StaffProfile doesn't carry it.
      const userRow = await resolveUserEmail(deps.db, profile.userId)
      if (userRow) {
        const refs = buildRedirectRefs(kind, {
          conversationId: params.conversationId ?? null,
          referenceId: params.referenceId ?? '',
          approvalId: params.approvalId,
          proposalId: params.proposalId,
        })
        const redirectPath = redirectPathFor(refs)
        // MagicLinkMintError propagates up — dispatcher catches it and writes the failure row.
        const mintResult = await mintMagicLink(auth, deps.db as ScopedDb, {
          userId: profile.userId,
          email: userRow.email,
          tenantId,
          organizationId,
          redirectPath,
        })
        buttonUrlSuffix = urlToSuffix(mintResult.url)
      } else {
        // User row not found — fall back to tenant slug path (defensive).
        const tenantSlug = process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
        const convId = params.conversationId ?? ''
        buttonUrlSuffix = tenantSlug ? `${tenantSlug}/conversations/${convId}` : `conversations/${convId}`
      }
    } else {
      // Dev/test fallback: use tenant slug + conversation path. Not a real magic-link.
      const tenantSlug = process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
      const convId = params.conversationId ?? ''
      buttonUrlSuffix = tenantSlug ? `${tenantSlug}/conversations/${convId}` : `conversations/${convId}`
    }

    try {
      const res = await sendTemplate({
        organizationId,
        staffPhoneE164: profile.phoneNumber,
        templateName,
        bodyParams,
        buttonUrlSuffix,
      })
      return { ok: true, messageId: res.messageId }
    } catch (err) {
      if (err instanceof PlatformHandshakeError) {
        return { ok: false, reason: err.code ?? `platform_${err.status ?? 'error'}` }
      }
      return { ok: false, reason: err instanceof Error ? err.message : 'send_failed' }
    }
  }

  async function fanOutNoteMentions(note: MentionFanOutNote): Promise<FanOutResult> {
    const result: FanOutResult = { notified: [], skipped: [] }
    const staffIds = Array.from(new Set(note.mentions.map(parseStaffMention).filter((x): x is string => Boolean(x))))
    logger.info(
      {
        noteId: note.id,
        conversationId: note.conversationId,
        authorType: note.authorType,
        mentionsRaw: note.mentions,
        staffIds,
        hasSendTemplate: Boolean(sendTemplate),
      },
      '[team/staff-ping] fanOutNoteMentions start',
    )
    if (staffIds.length === 0) return result

    const askingAgentId: string | null = note.authorType === 'agent' ? note.authorId : null

    const agentName = await (askingAgentId ? resolveAgentName(deps.db, askingAgentId) : Promise.resolve('your agent'))
    const snippet = trimSnippet(note.body)

    // US-021: gate the fan-out on `auth.user.phoneNumberVerified`. Unverified
    // staff are routed through the email-fallback seam (best-effort — fires only
    // when an adapter is wired) and recorded with `reason: 'phone_unverified'`
    // so the caller can see exactly how many WA pings were suppressed.
    const gating = await applyVerificationGating(staffIds, note.organizationId)
    const verifiedSet = new Set(gating.verified)
    await Promise.all(
      gating.unverified.map(async (userId) => {
        if (sendEmailFallback) {
          try {
            await sendEmailFallback({
              organizationId: note.organizationId,
              staffUserId: userId,
              conversationId: note.conversationId,
              noteId: note.id,
              body: snippet,
            })
          } catch (err) {
            logger.warn(
              { err, userId, noteId: note.id },
              '[team/staff-ping] sendEmailFallback failed (non-fatal — skip row still recorded)',
            )
          }
        }
        result.skipped.push({ userId, reason: 'phone_unverified' })
        const recipientDisplayName = await resolveStaffDisplayName(userId)
        await recordNotificationSuppressed({
          conversationId: note.conversationId,
          organizationId: note.organizationId,
          kind: 'mention',
          channel: 'whatsapp',
          recipientStaffId: userId,
          recipientDisplayName,
          suppressionReason: 'unverified',
        })
      }),
    )

    await Promise.all(
      staffIds
        .filter((id) => verifiedSet.has(id))
        .map(async (userId) => {
          try {
            const profile = await findStaff(userId)
            if (!profile || profile.organizationId !== note.organizationId) {
              result.skipped.push({ userId, reason: 'no_profile' })
              return
            }
            const displayName = profile.displayName ?? userId
            if (!isOffline(profile.lastSeenAt)) {
              result.skipped.push({ userId, reason: 'online' })
              await emitMentionSuppressed(note, userId, displayName, 'offline')
              return
            }
            const prefs = await getPrefs(userId)
            const cell = prefs.prefs.mention ?? {}
            if (cell.whatsapp !== true) {
              // User has opted out of WA-for-mentions in their matrix (or never opted in).
              // We surface this as a single 'channel_disabled' skip — the matrix collapses
              // the old `mentions_enabled` + `whatsapp_enabled` flat toggles into one cell.
              result.skipped.push({ userId, reason: 'channel_disabled' })
              await emitMentionSuppressed(note, userId, displayName, 'paused')
              return
            }
            const send = await sendNotification(note.organizationId, profile, 'mention', {
              snippet,
              agentName,
              conversationId: note.conversationId,
            })
            if (!send.ok) {
              result.skipped.push({ userId, reason: send.reason })
              return
            }
            if (askingAgentId) {
              try {
                await recordPing({
                  conversationId: note.conversationId,
                  staffUserId: userId,
                  organizationId: note.organizationId,
                  askingAgentId,
                  originalNoteId: note.id,
                  kind: 'mention',
                  outboundWamid: send.messageId,
                })
              } catch (err) {
                logger.warn({ err }, '[team/staff-ping] recordPing failed (non-fatal)')
              }
            }
            await recordNotificationSent({
              conversationId: note.conversationId,
              organizationId: note.organizationId,
              kind: 'mention',
              channel: 'whatsapp',
              recipientStaffId: userId,
              recipientDisplayName: displayName,
              messageId: send.messageId ?? '',
            })
            result.notified.push(userId)
          } catch (err) {
            result.skipped.push({ userId, reason: err instanceof Error ? err.message : 'error' })
          }
        }),
    )

    logger.info(
      {
        noteId: note.id,
        notified: result.notified,
        skipped: result.skipped,
      },
      '[team/staff-ping] fanOutNoteMentions done',
    )
    return result
  }

  async function enqueueFanOut(note: InternalNote): Promise<void> {
    if (!jobs) {
      logger.warn(
        { noteId: note.id, mentions: note.mentions },
        '[team/staff-ping] enqueueFanOut skipped — no jobs scheduler installed',
      )
      return
    }
    logger.info(
      { noteId: note.id, mentions: note.mentions, authorType: note.authorType },
      '[team/staff-ping] enqueueFanOut',
    )
    const payload: FanOutMentionPingsPayload = {
      note: {
        id: note.id,
        organizationId: note.organizationId,
        conversationId: note.conversationId,
        authorType: note.authorType,
        authorId: note.authorId,
        body: note.body,
        mentions: note.mentions,
      },
    }
    await jobs.send(FANOUT_MENTION_PINGS_JOB, payload, {
      singletonKey: `fanout-mention:${note.id}`,
    })
  }

  return { fanOutNoteMentions, enqueueFanOut }
}

let _current: MentionNotifyService | null = null
export function installMentionNotifyService(svc: MentionNotifyService): void {
  _current = svc
}
export function __resetMentionNotifyServiceForTests(): void {
  _current = null
}
function current(): MentionNotifyService {
  if (!_current) {
    throw new Error('team/staff-ping: service not installed — call installMentionNotifyService() in module init')
  }
  return _current
}

export function fanOutNoteMentions(note: MentionFanOutNote): Promise<FanOutResult> {
  return current().fanOutNoteMentions(note)
}

export function enqueueMentionFanOut(note: InternalNote): Promise<void> {
  return current().enqueueFanOut(note)
}

// Re-export MagicLinkMintError so dispatcher can catch it without importing auth directly.
export { MagicLinkMintError }

/**
 * Staff ping primitive: WhatsApp notifications to staff for conversation events.
 *
 * Four kinds: `mention` (internal note @-mention), `approval`, `proposal`, `admin_alert`.
 * Template selection gates on `channel_instances.config.metaTemplateApprovals`; falls back
 * to `vobase_inbox_mention_v2` when the per-kind template is unapproved.
 * Magic-link minting is post-commit — never inside a producer transaction.
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
import { getConversationContactId } from '@modules/messaging/service/conversations'
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
 * Send a staff ping for a conversation event.
 *
 * Cooldown is enforced by the caller — this function does not re-check.
 * Returns `suppressed_unverified` when `auth.user.phoneNumberVerified !== true`
 * (NULL is treated as unverified).
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
 * Parse a staff WhatsApp reply and route it to the appropriate decision service.
 *
 * 'mention' and 'admin_alert' are ack-only — no decision is recorded.
 * 'approval' calls `pendingApprovals.decide`; 'proposal' calls `decideChangeProposal`.
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

/** Send a WA notification template to a staff phone. Tests inject a stub. */
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
 * e.g. `https://platform.vobase.dev/api/redirect?...` → `api/redirect?...`
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
 * Build the `RedirectRefs` argument for `redirectPathFor` from a kind + ping refs.
 *
 * Conversation-scoped kinds deep-link into the inbox by CONTACT id (the
 * `/inbox/$contactId` route) — callers resolve `contactId` from the
 * conversation before invoking this (see `getConversationContactId`). A null
 * `contactId` falls back to `/inbox`. `admin_alert` carries no conversation.
 */
export function buildRedirectRefs(kind: PingKind, refs: { contactId: string | null }): RedirectRefs {
  switch (kind) {
    case 'mention':
      return { kind: 'mention', contactId: refs.contactId ?? '' }
    case 'approval':
      return { kind: 'approval', contactId: refs.contactId ?? '' }
    case 'proposal':
      return { kind: 'proposal', contactId: refs.contactId ?? '' }
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
 * Select template + body params for a given kind.
 * Uses the per-kind template only when `metaTemplateApprovals[templateName] === 'approved'`;
 * falls back to `vobase_inbox_mention_v2` otherwise.
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

/** Email fallback for staff with unverified phones. Tests inject a stub. */
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
  /**
   * Dev-only: send a test notification of `kind` to the given staff user's own
   * WhatsApp. No ping-ledger or timeline write — purely exercises the send path.
   */
  sendTestNotification(
    kind: PingKind,
    userId: string,
    organizationId: string,
  ): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }>
}

/** Placeholder body content for a dev test notification of each kind. */
function buildTestParams(kind: PingKind): {
  snippet?: string
  agentName?: string
  summary?: string
  detail?: string
  alertHeadline?: string
  alertDetail?: string
  organizationName?: string
  conversationId: string | null
  referenceId: string
} {
  switch (kind) {
    case 'mention':
      return {
        agentName: 'Vobase',
        snippet: 'Test mention — your WhatsApp notifications are working.',
        conversationId: null,
        referenceId: 'test',
      }
    case 'approval':
    case 'proposal':
      return {
        agentName: 'Vobase',
        summary: 'Test decision request',
        detail: 'This is a test notification — no action needed.',
        conversationId: null,
        referenceId: 'test',
      }
    case 'admin_alert':
      return {
        alertHeadline: 'Test admin alert',
        alertDetail: 'This is a test notification — no action needed.',
        organizationName: 'Vobase',
        conversationId: null,
        referenceId: 'test',
      }
  }
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

/** `StaffProfile` doesn't carry email — look it up from `auth_user`. */
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

    const metaTemplateApprovals =
      typeof channel.config?.metaTemplateApprovals === 'object' && channel.config.metaTemplateApprovals !== null
        ? (channel.config.metaTemplateApprovals as Record<string, unknown>)
        : null

    const { templateName, bodyParams } = buildTemplateForDispatch(kind, params, metaTemplateApprovals)

    let buttonUrlSuffix: string
    if (auth && profile.userId) {
      const userRow = await resolveUserEmail(deps.db, profile.userId)
      if (userRow) {
        // The inbox deep link is keyed by contactId — resolve it from the
        // conversation before building the redirect refs.
        const contactId = params.conversationId ? await getConversationContactId(deps.db, params.conversationId) : null
        const refs = buildRedirectRefs(kind, { contactId })
        const redirectPath = redirectPathFor(refs)
        const mintResult = await mintMagicLink(auth, deps.db as ScopedDb, {
          userId: profile.userId,
          email: userRow.email,
          organizationId,
          redirectPath,
        })
        buttonUrlSuffix = urlToSuffix(mintResult.url)
      } else {
        const tenantSlug = process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
        const convId = params.conversationId ?? ''
        buttonUrlSuffix = tenantSlug ? `${tenantSlug}/conversations/${convId}` : `conversations/${convId}`
      }
    } else {
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

    // Unverified staff route through the email-fallback seam (best-effort) and are
    // recorded with reason='phone_unverified' so the caller can count WA suppressions.
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
            const prefs = await getPrefs(userId)
            // Online staff see the @-mention in-app, so the WhatsApp ping is
            // skipped as redundant — unless this staff member opted in via the
            // per-user "notify while online" preference.
            if (!prefs.notifyWhileOnline && !isOffline(profile.lastSeenAt)) {
              result.skipped.push({ userId, reason: 'online' })
              await emitMentionSuppressed(note, userId, displayName, 'offline')
              return
            }
            const cell = prefs.prefs.mention ?? {}
            if (cell.whatsapp !== true) {
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

  async function sendTestNotification(
    kind: PingKind,
    userId: string,
    organizationId: string,
  ): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }> {
    const profile = await findStaff(userId)
    if (!profile || profile.organizationId !== organizationId) {
      return { ok: false, reason: 'no_profile' }
    }
    return sendNotification(organizationId, profile, kind, buildTestParams(kind))
  }

  return { fanOutNoteMentions, enqueueFanOut, sendTestNotification }
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

/** Dev-only: send a test WhatsApp notification of `kind` to a staff user's own phone. */
export function sendTestNotification(
  kind: PingKind,
  userId: string,
  organizationId: string,
): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }> {
  return current().sendTestNotification(kind, userId, organizationId)
}

// Re-export MagicLinkMintError so dispatcher can catch it without importing auth directly.
export { MagicLinkMintError }

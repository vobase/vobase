/**
 * Mention fan-out — T7b. For each `@staff:<userId>` mention on an internal
 * note, resolve the user's presence + notification prefs. If they're offline
 * (no `lastSeenAt` or older than 2 minutes) and opted into WhatsApp
 * notifications, send a WA ping pointing back at the conversation.
 *
 * Sends through the org's notification-tier WhatsApp channel
 * (`channels/service/instances::findNotificationChannel`) — not the customer-
 * facing WhatsApp channel — and dials the staff member's `phoneNumber` (their
 * personal phone, joined in from the better-auth `user` table by the staff
 * service; set by an admin at invite time or via the staff profile form).
 *
 * On a successful send the service writes a row to `pending_mention_pings`
 * (TTL ledger) so the inbound notifications handler can correlate the
 * staff's WA reply back to the originating conversation and route it as
 * an internal-note ask-staff-answer.
 *
 * Best-effort: per-mention failures are swallowed so a flaky provider never
 * blocks the note insert. Never throws.
 *
 * Invocation path: producers (the `consult_staff` tool, the HTTP notes
 * handler) call `enqueueFanOut`, which enqueues `FANOUT_MENTION_PINGS_JOB`;
 * the team module's job handler then runs `fanOutNoteMentions` on the worker.
 * This keeps the WhatsApp I/O + `pending_mention_pings` write off the request
 * path, so they survive a process recycle and get pg-boss retry semantics.
 */

import { agentDefinitions } from '@modules/agents/schema'
import { findNotificationChannel } from '@modules/channels/service/instances'
import { PlatformHandshakeError } from '@modules/integrations/service/handshake'
import type { InternalNote } from '@modules/messaging/schema'
import { getPrefs } from '@modules/settings/service/notification-prefs'
import { recordPing } from '@modules/team/service/pending-staff-pings'
import { find as findStaff } from '@modules/team/service/staff'
import { logger, type ScopedScheduler } from '@vobase/core'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { PRESENCE_THRESHOLD_MS } from '~/runtime/presence'
import type { StaffProfile } from '../schema'

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
 * Test seam: send a `vobase_tenant_notification` template to a staff phone.
 * Production wires the real `sendNotificationTemplate` closure with platform
 * creds resolved once at boot; tests pass a stub so they don't have to mock
 * global fetch + platform env.
 */
export type SendTemplateFn = (input: {
  staffPhoneE164: string
  bodyParams: [string, string, string]
  buttonUrlSuffix: string
}) => Promise<{ ok: true; messageId: string | null }>

interface MentionNotifyDeps {
  db: unknown
  /** pg-boss queue for the durable fan-out enqueue. Omitted in unit-test contexts — `enqueueFanOut` then no-ops. */
  jobs?: Pick<ScopedScheduler, 'send'> | null
  /** Template-send seam. Omitted in unit-test contexts — `sendNotification` returns `platform_not_configured`. */
  sendTemplate?: SendTemplateFn
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

async function resolveMentionerName(db: unknown, note: MentionFanOutNote): Promise<string> {
  if (note.authorType === 'agent') return resolveAgentName(db, note.authorId)
  if (note.authorType === 'staff') {
    try {
      const profile = await findStaff(note.authorId)
      return profile?.displayName ?? note.authorId
    } catch {
      return note.authorId
    }
  }
  return 'System'
}

export function createMentionNotifyService(deps: MentionNotifyDeps): MentionNotifyService {
  const jobs = deps.jobs ?? null
  const sendTemplate = deps.sendTemplate ?? null

  // Preserve "WHEN" semantics — only the WHERE (notification channel + staff
  // phone) changed. Staff-authored notes do NOT trigger mention fan-out (the
  // messaging notes handler always calls this, but we early-out below when the
  // author isn't an agent so no `pendingPing` row is written for
  // staff-authored notes — there is no agent to wake on reply).

  async function sendNotification(
    organizationId: string,
    profile: StaffProfile,
    params: {
      mentionerName: string
      snippet: string
      agentName: string
      buttonUrlSuffix: string
    },
  ): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }> {
    // `findNotificationChannel` is the existence gate — without an active
    // notification claim the platform endpoint will 409 `no_claim` anyway,
    // so failing early gives a more useful skip reason in the result.
    const channel = await findNotificationChannel(organizationId)
    if (!channel) return { ok: false, reason: 'no_notification_channel' }
    if (!profile.phoneNumber) return { ok: false, reason: 'no_whatsapp_phone' }
    if (!sendTemplate) return { ok: false, reason: 'platform_not_configured' }
    try {
      const res = await sendTemplate({
        staffPhoneE164: profile.phoneNumber,
        bodyParams: [params.mentionerName, params.snippet, params.agentName],
        buttonUrlSuffix: params.buttonUrlSuffix,
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
      '[team/mention-notify] fanOutNoteMentions start',
    )
    if (staffIds.length === 0) return result

    // Only agent-authored notes spawn a `pendingStaffPings` row (no agent
    // to wake on reply otherwise). Staff-authored notes still send the WA
    // ping (preserving today's semantics) but skip the ping ledger.
    const askingAgentId: string | null = note.authorType === 'agent' ? note.authorId : null

    // Resolve template params once per note — every recipient gets the same
    // mentioner/snippet/agent triple, so the DB lookups are batched outside
    // the per-staff Promise.all.
    const [mentionerName, agentName] = await Promise.all([
      resolveMentionerName(deps.db, note),
      askingAgentId ? resolveAgentName(deps.db, askingAgentId) : Promise.resolve('your agent'),
    ])
    const snippet = trimSnippet(note.body)
    // Deep-link target the URL button appends after `https://platform.voltade.app/`.
    // The redirect endpoint isn't built yet; this still renders the template
    // and gives us a stable shape to wire up later.
    const tenantSlug = process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
    const buttonUrlSuffix = tenantSlug
      ? `${tenantSlug}/conversations/${note.conversationId}`
      : `conversations/${note.conversationId}`

    await Promise.all(
      staffIds.map(async (userId) => {
        try {
          const profile = await findStaff(userId)
          if (!profile || profile.organizationId !== note.organizationId) {
            result.skipped.push({ userId, reason: 'no_profile' })
            return
          }
          if (!isOffline(profile.lastSeenAt)) {
            result.skipped.push({ userId, reason: 'online' })
            return
          }
          const prefs = await getPrefs(userId)
          if (!prefs.mentionsEnabled) {
            result.skipped.push({ userId, reason: 'mentions_disabled' })
            return
          }
          if (!prefs.whatsappEnabled) {
            result.skipped.push({ userId, reason: 'channel_disabled' })
            return
          }
          const send = await sendNotification(note.organizationId, profile, {
            mentionerName,
            snippet,
            agentName,
            buttonUrlSuffix,
          })
          if (!send.ok) {
            result.skipped.push({ userId, reason: send.reason })
            return
          }
          // Record the ping AFTER a successful WA send. Only when an agent
          // authored the note — otherwise there's no agent to wake on reply.
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
              // Non-fatal — the WA ping went out; the staff may still answer
              // in-app. Log for visibility.
              logger.warn({ err }, '[team/mention-notify] recordPing failed (non-fatal)')
            }
          }
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
      '[team/mention-notify] fanOutNoteMentions done',
    )
    return result
  }

  async function enqueueFanOut(note: InternalNote): Promise<void> {
    // No installed queue (unit-test / no-scheduler boot) → silently no-op,
    // mirroring `syncStaffLinksEnqueue`. Production always wires `ctx.jobs`.
    if (!jobs) {
      logger.warn(
        { noteId: note.id, mentions: note.mentions },
        '[team/mention-notify] enqueueFanOut skipped — no jobs scheduler installed',
      )
      return
    }
    logger.info(
      { noteId: note.id, mentions: note.mentions, authorType: note.authorType },
      '[team/mention-notify] enqueueFanOut',
    )
    // Carry only the fields the fan-out consumes — drops `createdAt` (a Date
    // that JSON-serializes to a string) and keeps the queue row small.
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
      // Dedup pg-boss retries by note — fan-out for a note is idempotent-enough
      // (online/already-pinged staff are skipped) and must not double-fire.
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
    throw new Error('team/mention-notify: service not installed — call installMentionNotifyService() in module init')
  }
  return _current
}

export function fanOutNoteMentions(note: MentionFanOutNote): Promise<FanOutResult> {
  return current().fanOutNoteMentions(note)
}

export function enqueueMentionFanOut(note: InternalNote): Promise<void> {
  return current().enqueueFanOut(note)
}

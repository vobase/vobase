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
 */

import { findNotificationChannel } from '@modules/channels/service/instances'
import { get as channelRegistryGet } from '@modules/channels/service/registry'
import type { InternalNote } from '@modules/messaging/schema'
import { getPrefs } from '@modules/settings/service/notification-prefs'
import { recordPing } from '@modules/team/service/pending-mention-pings'
import { find as findStaff } from '@modules/team/service/staff'
import { logger } from '@vobase/core'

import { PRESENCE_THRESHOLD_MS } from '~/runtime/presence'
import type { StaffProfile } from '../schema'

interface MentionNotifyDeps {
  db: unknown
}

export interface FanOutResult {
  notified: string[]
  skipped: Array<{ userId: string; reason: string }>
}

export interface MentionNotifyService {
  fanOutNoteMentions(note: InternalNote): Promise<FanOutResult>
}

function parseStaffMention(raw: string): string | null {
  return raw.startsWith('staff:') ? raw.slice('staff:'.length) : null
}

function isOffline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return true
  return Date.now() - new Date(lastSeenAt).getTime() > PRESENCE_THRESHOLD_MS
}

function buildNotificationText(note: InternalNote): string {
  const preview = note.body.length > 200 ? `${note.body.slice(0, 197)}…` : note.body
  return `You were mentioned in a note:\n\n${preview}`
}

export function createMentionNotifyService(_deps: MentionNotifyDeps): MentionNotifyService {
  // Preserve "WHEN" semantics — only the WHERE (notification channel + staff
  // phone) changed. Staff-authored notes do NOT trigger mention fan-out (the
  // messaging notes handler always calls this, but we early-out below when the
  // author isn't an agent so no `pendingPing` row is written for
  // staff-authored notes — there is no agent to wake on reply).

  async function sendNotification(
    organizationId: string,
    profile: StaffProfile,
    text: string,
  ): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string }> {
    const channel = await findNotificationChannel(organizationId)
    if (!channel) return { ok: false, reason: 'no_notification_channel' }
    if (!profile.phoneNumber) return { ok: false, reason: 'no_whatsapp_phone' }
    // Route through the registry — same seam `outbound.ts` uses, so tests
    // can swap the adapter via `register('whatsapp_notif', stubFactory, ...)`
    // without touching the integrations vault.
    const adapter = await channelRegistryGet(channel.channel, channel.config ?? {}, channel.id)
    if (!adapter) return { ok: false, reason: 'no_adapter_registered' }
    const res = await adapter.send({ to: profile.phoneNumber, text })
    if (!res.success) return { ok: false, reason: 'adapter_error' }
    // `messageId` is the WA wamid — recorded on the ping so a staff reply that
    // quotes this message can exact-match back. Null when the provider/stub
    // returned no id.
    return { ok: true, messageId: res.messageId ?? null }
  }

  async function fanOutNoteMentions(note: InternalNote): Promise<FanOutResult> {
    const result: FanOutResult = { notified: [], skipped: [] }
    const staffIds = Array.from(new Set(note.mentions.map(parseStaffMention).filter((x): x is string => Boolean(x))))
    if (staffIds.length === 0) return result

    // Only agent-authored notes spawn a `pendingMentionPings` row (no agent
    // to wake on reply otherwise). Staff-authored notes still send the WA
    // ping (preserving today's semantics) but skip the ping ledger.
    const askingAgentId: string | null = note.authorType === 'agent' ? note.authorId : null

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
          const send = await sendNotification(note.organizationId, profile, buildNotificationText(note))
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

    return result
  }

  return { fanOutNoteMentions }
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

export function fanOutNoteMentions(note: InternalNote): Promise<FanOutResult> {
  return current().fanOutNoteMentions(note)
}

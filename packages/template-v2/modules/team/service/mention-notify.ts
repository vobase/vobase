/**
 * Mention fan-out — T7b. For each `@staff:<userId>` mention on an internal
 * note, resolve the user's presence + notification prefs. If they're offline
 * (no `lastSeenAt` or older than 2 minutes) and opted into WhatsApp
 * notifications, send a WA ping pointing back at the conversation.
 *
 * Best-effort: per-mention failures are swallowed so a flaky provider never
 * blocks the note insert. Never throws.
 */

import type { InternalNote } from '@modules/messaging/schema'
import { getPrefs } from '@modules/settings/service/notification-prefs'
import { find as findStaff } from '@modules/team/service/staff'

const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000

interface ChannelInstanceRow {
  id: string
  config: Record<string, unknown> | null
}

interface StaffBindingRow {
  userId: string
  channelInstanceId: string
  externalIdentifier: string
}

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
  return Date.now() - new Date(lastSeenAt).getTime() > OFFLINE_THRESHOLD_MS
}

function buildNotificationText(note: InternalNote): string {
  const preview = note.body.length > 200 ? `${note.body.slice(0, 197)}…` : note.body
  return `You were mentioned in a note:\n\n${preview}`
}

export function createMentionNotifyService(deps: MentionNotifyDeps): MentionNotifyService {
  const db = deps.db as { select: Function }

  async function findWhatsappChannel(organizationId: string): Promise<ChannelInstanceRow | null> {
    const { channelInstances } = await import('@modules/messaging/schema')
    const { and, eq } = await import('drizzle-orm')
    const rows = (await db
      .select({ id: channelInstances.id, config: channelInstances.config })
      .from(channelInstances)
      .where(
        and(
          eq(channelInstances.organizationId, organizationId),
          eq(channelInstances.type, 'whatsapp'),
          eq(channelInstances.status, 'active'),
        ),
      )
      .limit(1)) as ChannelInstanceRow[]
    return rows[0] ?? null
  }

  async function findBinding(userId: string, channelInstanceId: string): Promise<StaffBindingRow | null> {
    const { staffChannelBindings } = await import('@modules/contacts/schema')
    const { and, eq } = await import('drizzle-orm')
    const rows = (await db
      .select()
      .from(staffChannelBindings)
      .where(
        and(eq(staffChannelBindings.userId, userId), eq(staffChannelBindings.channelInstanceId, channelInstanceId)),
      )
      .limit(1)) as StaffBindingRow[]
    return rows[0] ?? null
  }

  async function sendWhatsapp(organizationId: string, userId: string, text: string): Promise<boolean> {
    const channel = await findWhatsappChannel(organizationId)
    if (!channel) return false
    const binding = await findBinding(userId, channel.id)
    if (!binding) return false
    const cfg = (channel.config ?? {}) as { phoneNumberId?: string; accessToken?: string }
    const phoneNumberId = cfg.phoneNumberId ?? process.env.WA_PHONE_NUMBER_ID ?? ''
    const accessToken = cfg.accessToken ?? process.env.WA_ACCESS_TOKEN ?? ''
    if (!phoneNumberId || !accessToken) return false
    const { sendOutbound } = await import('@modules/channels/whatsapp/service/sender')
    const res = await sendOutbound(
      {
        toolName: 'reply',
        payload: { text },
        organizationId,
        conversationId: 'notify',
        contactId: `staff:${userId}`,
        wakeId: 'mention-notify',
        channelType: 'whatsapp',
      },
      binding.externalIdentifier,
      { phoneNumberId, accessToken },
    )
    return res.success
  }

  async function fanOutNoteMentions(note: InternalNote): Promise<FanOutResult> {
    const result: FanOutResult = { notified: [], skipped: [] }
    const staffIds = Array.from(new Set(note.mentions.map(parseStaffMention).filter((x): x is string => Boolean(x))))
    if (staffIds.length === 0) return result

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
          const ok = await sendWhatsapp(note.organizationId, userId, buildNotificationText(note))
          if (!ok) {
            result.skipped.push({ userId, reason: 'no_binding_or_config' })
            return
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

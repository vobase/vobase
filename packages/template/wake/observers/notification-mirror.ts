/**
 * Mirror standalone-lane assistant `message_end` events out the org's
 * notification WhatsApp channel to the staff member's personal WhatsApp.
 *
 * `notificationChannelInstanceId` is captured at wake-builder time. The
 * recipient phone is NOT frozen — it is resolved fresh on every dispatch
 * from `(staffUserId, organizationId)`, because the number can change
 * mid-wake and each send must re-confirm the user is still a verified staff
 * member of this org before any reply (which may carry customer PII) goes out.
 *
 * Fires on `message_end` (final assistant text) only — not on
 * `message_update` deltas (per `template/CLAUDE.md` "Wake event order").
 *
 * Frozen-snapshot safe: this observer is wired into `coreListeners` only,
 * never into the system-prompt input chain — its mid-wake DB reads do not
 * affect `systemHash`.
 */

import { authUser } from '@auth/schema'
import { findNotificationChannel } from '@modules/channels/service/instances'
import { get as channelRegistryGet } from '@modules/channels/service/registry'
import { hasStaffPrefix } from '@modules/messaging/lib/staff-prefix'
import { staffProfiles } from '@modules/team/schema'
import type { HarnessLogger, OnEventListener } from '@vobase/core'
import { and, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import type { WakeTrigger } from '../events'

export interface NotificationMirrorOpts {
  organizationId: string
  threadId: string
  agentName?: string | null
  db: ScopedDb
  /** Operator-thread creator's user id; the phone is resolved fresh per dispatch. */
  staffUserId: string | null
  notificationChannelInstanceId: string | null
  logger: HarnessLogger
}

export function createNotificationMirrorObserver(opts: NotificationMirrorOpts): OnEventListener<WakeTrigger> {
  return async (event) => {
    if (event.type !== 'message_end') return
    const ev = event as { type: 'message_end'; role?: string; content?: string }
    if (ev.role !== 'assistant') return
    const text = (ev.content ?? '').trim()
    if (!text) return
    if (!opts.staffUserId || !opts.notificationChannelInstanceId) return

    // Resolve the recipient phone fresh per dispatch — re-confirms the user is
    // still a verified staff member of this org before any PII leaves.
    const [recipient] = await opts.db
      .select({ phone: authUser.phoneNumber })
      .from(staffProfiles)
      .innerJoin(authUser, eq(authUser.id, staffProfiles.userId))
      .where(
        and(
          eq(staffProfiles.userId, opts.staffUserId),
          eq(staffProfiles.organizationId, opts.organizationId),
          eq(authUser.phoneNumberVerified, true),
        ),
      )
      .limit(1)
    if (!recipient?.phone) return

    // Bracket-prefix so staff can tell the agent's reply apart from other
    // notification-channel traffic; skip if the agent already bracketed it.
    const outboundText = hasStaffPrefix(text) ? text : `[${opts.agentName || 'Agent'}]: ${text}`

    try {
      // Fresh adapter per dispatch — the registry creates one per call too.
      // `findNotificationChannel` is the source of truth for the live config
      // (in case the row's `config` mutated mid-wake from a row update).
      const channel = await findNotificationChannel(opts.organizationId)
      if (!channel || channel.id !== opts.notificationChannelInstanceId) {
        // Channel was released or replaced mid-wake — silently skip.
        return
      }
      const adapter = await channelRegistryGet(channel.channel, channel.config ?? {}, channel.id)
      if (!adapter) return
      const res = await adapter.send({ to: recipient.phone, text: outboundText })
      if (!res.success) {
        opts.logger.warn?.(
          { threadId: opts.threadId, code: res.code, error: res.error },
          'notification-mirror: outbound send failed',
        )
      }
    } catch (err) {
      opts.logger.warn?.({ err, threadId: opts.threadId }, 'notification-mirror: outbound send threw')
    }
  }
}

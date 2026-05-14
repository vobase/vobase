/**
 * Mirror standalone-lane assistant `message_end` events out the org's
 * notification WhatsApp channel to the staff member's personal WhatsApp.
 *
 * Resolved at wake start (so we never query mid-turn or thread DB lookups
 * into the frozen-snapshot inputs):
 *   - notificationChannelInstanceId — single 'whatsapp_notif' channel for the org
 *   - staffPhoneE164                — the better-auth `user.phone_number` of
 *                                     the operator-thread's createdBy user
 *
 * Fires on `message_end` (final assistant text) only — not on
 * `message_update` deltas (per `template/CLAUDE.md` "Wake event order").
 *
 * Frozen-snapshot safe: this observer is wired into `coreListeners` only,
 * never into the system-prompt input chain.  All identity (channel id,
 * staff phone) is captured at wake-builder time and frozen for the wake's
 * lifetime.
 */

import { findNotificationChannel } from '@modules/channels/service/instances'
import { get as channelRegistryGet } from '@modules/channels/service/registry'
import type { HarnessLogger, OnEventListener } from '@vobase/core'

import type { WakeTrigger } from '../events'

export interface NotificationMirrorOpts {
  organizationId: string
  threadId: string
  staffPhoneE164: string | null
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
    if (!opts.staffPhoneE164 || !opts.notificationChannelInstanceId) return

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
      const res = await adapter.send({ to: opts.staffPhoneE164, text })
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

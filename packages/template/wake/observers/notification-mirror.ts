/**
 * Mirror standalone-lane assistant `message_end` events out the org's
 * notification WhatsApp number to the staff member's personal WhatsApp via
 * `sendNotificationText` (the per-org notification send seam backed by
 * `notification_settings`).
 *
 * Resolved at wake start (so we never query mid-turn or thread DB lookups
 * into the frozen-snapshot inputs):
 *   - hasNotificationSettings — whether the org has a notification row
 *   - staffPhoneE164          — the better-auth `user.phone_number` of the
 *                               operator-thread's createdBy user
 *
 * Fires on `message_end` (final assistant text) only — not on
 * `message_update` deltas (per `template/CLAUDE.md` "Wake event order").
 *
 * Frozen-snapshot safe: this observer is wired into `coreListeners` only,
 * never into the system-prompt input chain.  All identity is captured at
 * wake-builder time and frozen for the wake's lifetime.
 */

import { sendNotificationText } from '@modules/channels/service/notification-send'
import type { HarnessLogger, OnEventListener } from '@vobase/core'

import type { ScopedDb } from '~/runtime'
import type { WakeTrigger } from '../events'

export interface NotificationMirrorOpts {
  db: ScopedDb
  organizationId: string
  threadId: string
  staffPhoneE164: string | null
  /** True iff `notification_settings` exists for this org at wake time. */
  hasNotificationSettings: boolean
  logger: HarnessLogger
}

export function createNotificationMirrorObserver(opts: NotificationMirrorOpts): OnEventListener<WakeTrigger> {
  return async (event) => {
    if (event.type !== 'message_end') return
    const ev = event as { type: 'message_end'; role?: string; content?: string }
    if (ev.role !== 'assistant') return
    const text = (ev.content ?? '').trim()
    if (!text) return
    if (!opts.staffPhoneE164 || !opts.hasNotificationSettings) return

    try {
      const res = await sendNotificationText(opts.db, opts.organizationId, { to: opts.staffPhoneE164, text })
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

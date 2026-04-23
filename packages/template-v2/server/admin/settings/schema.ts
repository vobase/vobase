/**
 * settings module schema.
 *
 * Per-user notification preferences consumed by T7b mention fan-out. One row
 * per authenticated user, lazily created on first GET/PUT. Auth identity lives
 * in better-auth (`auth.user`) so we hold only the `userId` here (no FK —
 * auth tables live in a different pgSchema; cleanup handled at the app layer).
 */

import { settingsPgSchema } from '@server/db/pg-schemas'
import type { InferSelectModel } from 'drizzle-orm'
import { boolean, text, timestamp } from 'drizzle-orm/pg-core'

export interface UserNotificationPrefs {
  userId: string
  mentionsEnabled: boolean
  whatsappEnabled: boolean
  emailEnabled: boolean
  updatedAt: Date
}

export const userNotificationPrefs = settingsPgSchema.table('user_notification_prefs', {
  userId: text('user_id').primaryKey(),
  mentionsEnabled: boolean('mentions_enabled').notNull().default(true),
  whatsappEnabled: boolean('whatsapp_enabled').notNull().default(false),
  emailEnabled: boolean('email_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

type _PrefsAssert = InferSelectModel<typeof userNotificationPrefs> extends UserNotificationPrefs ? true : never
const _prefsOk: _PrefsAssert = true
void _prefsOk

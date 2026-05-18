/**
 * settings module schema.
 *
 * Per-user notification preferences consumed by T7b mention fan-out. One row
 * per authenticated user, lazily created on first GET/PUT. Auth identity lives
 * in better-auth (`auth.user`) so we hold only the `userId` here (no FK —
 * auth tables live in a different pgSchema; cleanup handled at the app layer).
 *
 * **Matrix prefs (US-024+).** Five flat booleans (`mentionsEnabled`,
 * `whatsappEnabled`, `emailEnabled`, `approvalsEnabled`, `proposalsEnabled`)
 * were replaced by a single `prefs jsonb` column holding the full
 * `NotificationKind × NotificationChannel` matrix. Reads merge with defaults
 * (in_app=true for all kinds; whatsapp=`phoneNumberVerified` at read time;
 * email=false) so missing keys never break dispatch.
 *
 * Plus a generic per-org key/value `org_settings` table for org-scoped
 * preferences such as `defaultOperatorAgentId`. Distinct from the per-user
 * `user_notification_prefs` so the two namespaces never collide.
 */

import type { InferSelectModel } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { settingsPgSchema } from '~/runtime'
import type { NotificationPrefsMatrix } from './notification-prefs-types'

export type { NotificationChannel, NotificationKind, NotificationPrefsMatrix } from './notification-prefs-types'
export { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from './notification-prefs-types'

export interface UserNotificationPrefs {
  userId: string
  prefs: NotificationPrefsMatrix
  updatedAt: Date
}

export const userNotificationPrefs = settingsPgSchema.table('user_notification_prefs', {
  userId: text('user_id').primaryKey(),
  prefs: jsonb('prefs').$type<NotificationPrefsMatrix>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

type _PrefsAssert = InferSelectModel<typeof userNotificationPrefs> extends UserNotificationPrefs ? true : never
const _prefsOk: _PrefsAssert = true
void _prefsOk

// ─── Per-org settings (generic key/value) ───────────────────────────────────

export interface OrgSetting {
  organizationId: string
  key: string
  value: string | null
  updatedAt: Date
}

/**
 * Generic per-org key/value bucket. Used for tenant-wide preferences such as
 * `defaultOperatorAgentId` (the agent that picks up first-time staff WhatsApp
 * threads on the notification channel). Kept distinct from per-USER
 * `user_notification_prefs` so the two namespaces never collide.
 */
export const orgSettings = settingsPgSchema.table(
  'org_settings',
  {
    organizationId: text('organization_id').notNull(),
    key: text('key').notNull(),
    value: text('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('uq_org_settings_org_key').on(t.organizationId, t.key)],
)

type _OrgSettingAssert = InferSelectModel<typeof orgSettings> extends OrgSetting ? true : never
const _orgSettingOk: _OrgSettingAssert = true
void _orgSettingOk

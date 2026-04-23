/**
 * Per-user notification preferences service. Lazily creates a default row on
 * first read so callers always get a concrete prefs object back.
 */

import type { UserNotificationPrefs } from '../schema'

interface PrefsDeps {
  db: unknown
}

export interface NotificationPrefsPatch {
  mentionsEnabled?: boolean
  whatsappEnabled?: boolean
  emailEnabled?: boolean
}

export interface NotificationPrefsService {
  get(userId: string): Promise<UserNotificationPrefs>
  upsert(userId: string, patch: NotificationPrefsPatch): Promise<UserNotificationPrefs>
}

function defaults(userId: string): UserNotificationPrefs {
  return {
    userId,
    mentionsEnabled: true,
    whatsappEnabled: false,
    emailEnabled: false,
    updatedAt: new Date(),
  }
}

export function createNotificationPrefsService(deps: PrefsDeps): NotificationPrefsService {
  const db = deps.db as { select: Function; insert: Function }

  async function get(userId: string): Promise<UserNotificationPrefs> {
    const { userNotificationPrefs } = await import('@server/admin/settings/schema')
    const { eq } = await import('drizzle-orm')
    const rows = (await db
      .select()
      .from(userNotificationPrefs)
      .where(eq(userNotificationPrefs.userId, userId))
      .limit(1)) as UserNotificationPrefs[]
    if (rows[0]) return rows[0]
    const created = (await db
      .insert(userNotificationPrefs)
      .values({ userId })
      .onConflictDoNothing()
      .returning()) as UserNotificationPrefs[]
    return created[0] ?? defaults(userId)
  }

  async function upsert(userId: string, patch: NotificationPrefsPatch): Promise<UserNotificationPrefs> {
    const { userNotificationPrefs } = await import('@server/admin/settings/schema')
    const values: Record<string, unknown> = { userId }
    const update: Record<string, unknown> = {}
    if (patch.mentionsEnabled !== undefined) {
      values.mentionsEnabled = patch.mentionsEnabled
      update.mentionsEnabled = patch.mentionsEnabled
    }
    if (patch.whatsappEnabled !== undefined) {
      values.whatsappEnabled = patch.whatsappEnabled
      update.whatsappEnabled = patch.whatsappEnabled
    }
    if (patch.emailEnabled !== undefined) {
      values.emailEnabled = patch.emailEnabled
      update.emailEnabled = patch.emailEnabled
    }
    const rows = (await db
      .insert(userNotificationPrefs)
      .values(values)
      .onConflictDoUpdate({ target: userNotificationPrefs.userId, set: update })
      .returning()) as UserNotificationPrefs[]
    const row = rows[0]
    if (!row) throw new Error('notification-prefs/upsert: insert returned no rows')
    return row
  }

  return { get, upsert }
}

let _current: NotificationPrefsService | null = null
export function installNotificationPrefsService(svc: NotificationPrefsService): void {
  _current = svc
}
export function __resetNotificationPrefsServiceForTests(): void {
  _current = null
}
function current(): NotificationPrefsService {
  if (!_current) {
    throw new Error(
      'settings/notification-prefs: service not installed — call installNotificationPrefsService() in module init',
    )
  }
  return _current
}
export function getPrefs(userId: string): Promise<UserNotificationPrefs> {
  return current().get(userId)
}
export function upsertPrefs(userId: string, patch: NotificationPrefsPatch): Promise<UserNotificationPrefs> {
  return current().upsert(userId, patch)
}

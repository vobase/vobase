/**
 * Per-user notification preferences service (US-024+ matrix).
 *
 * Storage: a single `prefs jsonb` column (see `../schema.ts`) holding a
 * `NotificationKind × NotificationChannel` matrix. The service lazily creates a
 * row on first read and ALWAYS returns a fully-filled matrix — every kind has
 * every channel set to an explicit boolean. Missing cells inherit from the
 * `defaultMatrix(verified)` policy below:
 *
 *   in_app   = true   for every kind
 *   whatsapp = `auth.user.phoneNumberVerified === true` at read time
 *   email    = false  for every kind
 *
 * The dynamic WhatsApp default flips with the user's phone-verified flag (no
 * write needed when verification lands), so callers see "WA on by default once
 * verified" without us re-running a migration.
 *
 * Writes are full-matrix: `upsert(userId, matrix)` replaces the stored cell
 * map verbatim. The Zod schema at the handler boundary normalises the input
 * to a sparse-or-full matrix, and the service merges in defaults on every
 * read — so even "save everything off" persists faithfully.
 */

import { authUser } from '@auth/schema'
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  type NotificationChannel,
  type NotificationKind,
  type NotificationPrefsMatrix,
  type UserNotificationPrefs,
  userNotificationPrefs,
} from '@modules/settings/schema'
import { eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

interface PrefsDeps {
  db: ScopedDb
}

/** Lookup of `auth.user.phoneNumberVerified` for a single user. Test-overridable. */
export type PhoneVerifiedLookup = (userId: string) => Promise<boolean>

export interface NotificationPrefsService {
  get(userId: string): Promise<UserNotificationPrefs>
  upsert(userId: string, matrix: NotificationPrefsMatrix, notifyWhileOnline: boolean): Promise<UserNotificationPrefs>
  isEnabled(userId: string, kind: NotificationKind, channel: NotificationChannel): Promise<boolean>
}

/**
 * Compute the default matrix for a user. `verified` reflects
 * `auth.user.phoneNumberVerified === true` at read time so the WA column flips
 * the moment a user completes OTP verification (no write to `prefs` required).
 */
export function defaultMatrix(verified: boolean): Required<{
  [K in NotificationKind]: Required<{ [C in NotificationChannel]: boolean }>
}> {
  const out = {} as Required<{
    [K in NotificationKind]: Required<{ [C in NotificationChannel]: boolean }>
  }>
  for (const kind of NOTIFICATION_KINDS) {
    out[kind] = {
      in_app: true,
      whatsapp: verified,
      email: false,
    }
  }
  return out
}

/**
 * Merge a stored sparse matrix with the verification-aware defaults so callers
 * always receive a fully-filled matrix. Stored cells take precedence; missing
 * cells fall back to the default policy. Unknown keys in storage are dropped.
 */
export function fillMatrix(stored: NotificationPrefsMatrix, verified: boolean): NotificationPrefsMatrix {
  const defaults = defaultMatrix(verified)
  const filled: NotificationPrefsMatrix = {}
  for (const kind of NOTIFICATION_KINDS) {
    const storedKind = stored[kind] ?? {}
    const cell: Partial<Record<NotificationChannel, boolean>> = {}
    for (const channel of NOTIFICATION_CHANNELS) {
      const v = storedKind[channel]
      cell[channel] = typeof v === 'boolean' ? v : defaults[kind][channel]
    }
    filled[kind] = cell
  }
  return filled
}

export function createNotificationPrefsService(deps: PrefsDeps): NotificationPrefsService {
  const { db } = deps

  async function lookupVerified(userId: string): Promise<boolean> {
    try {
      const rows = await db
        .select({ verified: authUser.phoneNumberVerified })
        .from(authUser)
        .where(eq(authUser.id, userId))
        .limit(1)
      return rows[0]?.verified === true
    } catch {
      return false
    }
  }

  async function get(userId: string): Promise<UserNotificationPrefs> {
    const rows = await db.select().from(userNotificationPrefs).where(eq(userNotificationPrefs.userId, userId)).limit(1)
    const verified = await lookupVerified(userId)
    if (rows[0]) {
      return {
        userId,
        prefs: fillMatrix(rows[0].prefs, verified),
        notifyWhileOnline: rows[0].notifyWhileOnline,
        updatedAt: rows[0].updatedAt,
      }
    }
    // Lazy-create an empty row so subsequent reads have a stable updatedAt.
    const created = await db
      .insert(userNotificationPrefs)
      .values({ userId, prefs: {} })
      .onConflictDoNothing()
      .returning()
    const row = created[0]
    return {
      userId,
      prefs: fillMatrix({}, verified),
      notifyWhileOnline: row?.notifyWhileOnline ?? false,
      updatedAt: row?.updatedAt ?? new Date(),
    }
  }

  async function upsert(
    userId: string,
    matrix: NotificationPrefsMatrix,
    notifyWhileOnline: boolean,
  ): Promise<UserNotificationPrefs> {
    const rows = await db
      .insert(userNotificationPrefs)
      .values({ userId, prefs: matrix, notifyWhileOnline })
      .onConflictDoUpdate({ target: userNotificationPrefs.userId, set: { prefs: matrix, notifyWhileOnline } })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('notification-prefs/upsert: insert returned no rows')
    const verified = await lookupVerified(userId)
    return {
      userId,
      prefs: fillMatrix(row.prefs, verified),
      notifyWhileOnline: row.notifyWhileOnline,
      updatedAt: row.updatedAt,
    }
  }

  async function isEnabled(userId: string, kind: NotificationKind, channel: NotificationChannel): Promise<boolean> {
    const { prefs } = await get(userId)
    return prefs[kind]?.[channel] === true
  }

  return { get, upsert, isEnabled }
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
export function upsertPrefs(
  userId: string,
  matrix: NotificationPrefsMatrix,
  notifyWhileOnline: boolean,
): Promise<UserNotificationPrefs> {
  return current().upsert(userId, matrix, notifyWhileOnline)
}
export function isEnabled(userId: string, kind: NotificationKind, channel: NotificationChannel): Promise<boolean> {
  return current().isEnabled(userId, kind, channel)
}

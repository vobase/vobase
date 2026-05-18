/**
 * Notification preference shapes shared across frontend + backend.
 *
 * Pure types + readonly constants — no runtime/Drizzle imports — so the
 * frontend can pull these without dragging the backend module graph (and
 * `node:crypto`) through Vite.
 */

export type NotificationKind = 'mention' | 'approval' | 'proposal' | 'admin_alert'

export type NotificationChannel = 'in_app' | 'whatsapp' | 'email'

export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['mention', 'approval', 'proposal', 'admin_alert']
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['in_app', 'whatsapp', 'email']

export type NotificationPrefsMatrix = Partial<Record<NotificationKind, Partial<Record<NotificationChannel, boolean>>>>

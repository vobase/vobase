/**
 * Notification preference shapes shared across frontend + backend.
 *
 * Pure types + readonly constants — no runtime/Drizzle imports — so the
 * frontend can pull these without dragging the backend module graph (and
 * `node:crypto`) through Vite.
 */

/**
 * `'decision'` covers both pending-approvals (agent paused mid-turn) and change
 * proposals (resource edits filed for staff review) — they share the same
 * `vobase_decision_required_v2` WhatsApp template, so the user gets one toggle
 * instead of two redundant ones. Internal `PingKind` in `team/service/staff-ping.ts`
 * keeps the `'approval'` / `'proposal'` discriminator because the dispatcher
 * still needs to route to the right decide endpoint.
 */
export type NotificationKind = 'mention' | 'decision' | 'admin_alert'

export type NotificationChannel = 'in_app' | 'whatsapp' | 'email'

export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['mention', 'decision', 'admin_alert']
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['in_app', 'whatsapp', 'email']

export type NotificationPrefsMatrix = Partial<Record<NotificationKind, Partial<Record<NotificationChannel, boolean>>>>

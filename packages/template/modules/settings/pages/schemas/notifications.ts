import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from '@modules/settings/notification-prefs-types'
import { z } from 'zod'

/**
 * Notification matrix (US-024+). Sparse-or-full record:
 * `{ [kind]: { [channel]: boolean } }`. Missing keys merge with defaults at
 * the service layer (see `service/notification-prefs.ts::fillMatrix`).
 */
const channelMapSchema = z.object(
  Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, z.boolean().optional()])) as Record<
    (typeof NOTIFICATION_CHANNELS)[number],
    z.ZodOptional<z.ZodBoolean>
  >,
)

export const notificationsSchema = z.object({
  matrix: z
    .object(
      Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, channelMapSchema.optional()])) as Record<
        (typeof NOTIFICATION_KINDS)[number],
        z.ZodOptional<typeof channelMapSchema>
      >,
    )
    .default({}),
  /** Per-user opt-in: receive mention WhatsApp pings even while online. */
  notifyWhileOnline: z.boolean().default(false),
})

export type NotificationsValues = z.infer<typeof notificationsSchema>

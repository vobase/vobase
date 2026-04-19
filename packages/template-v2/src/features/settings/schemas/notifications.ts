import { z } from 'zod'

export const notificationsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
})

export type NotificationsValues = z.infer<typeof notificationsSchema>

import { z } from 'zod'

export const notificationsSchema = z.object({
  mentionsEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  approvalsEnabled: z.boolean().optional(),
  proposalsEnabled: z.boolean().optional(),
})

export type NotificationsValues = z.infer<typeof notificationsSchema>

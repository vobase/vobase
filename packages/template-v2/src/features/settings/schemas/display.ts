import { z } from 'zod'

export const displaySchema = z.object({
  density: z.enum(['comfortable', 'compact']).optional(),
  showAvatars: z.boolean().optional(),
})

export type DisplayValues = z.infer<typeof displaySchema>

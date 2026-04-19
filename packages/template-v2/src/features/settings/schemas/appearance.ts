import { z } from 'zod'

export const appearanceSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  fontSize: z.enum(['sm', 'md', 'lg']).optional(),
})

export type AppearanceValues = z.infer<typeof appearanceSchema>

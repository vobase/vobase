import { z } from 'zod'

export const profileSchema = z.object({
  displayName: z.string().optional(),
  email: z.string().email().optional(),
})

export const accountSchema = z.object({
  timezone: z.string().optional(),
  language: z.string().optional(),
})

export type ProfileValues = z.infer<typeof profileSchema>
export type AccountValues = z.infer<typeof accountSchema>

// SET-FORMS appends: appearanceSchema, notificationsSchema, displaySchema, apiKeysSchema
// Export new schemas from this file and re-export below to keep one import surface.

import { z } from 'zod'

export const apiKeysSchema = z.object({
  name: z.string().min(1),
})

export type ApiKeysValues = z.infer<typeof apiKeysSchema>

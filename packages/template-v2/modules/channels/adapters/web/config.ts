/**
 * Zod schema for the web channel's `channel_instances.config` JSONB blob.
 * Source of truth for the config shape; the generic CRUD currently stores
 * opaque JSON, but the admin page types its create/patch payloads against this.
 */

import { z } from 'zod'

export const WebChannelConfigSchema = z.object({
  defaultAssignee: z.string().min(1).optional(),
  origin: z.string().url().optional(),
  starters: z.array(z.string().min(1).max(120)).max(8).optional(),
})

export type WebChannelConfig = z.infer<typeof WebChannelConfigSchema>

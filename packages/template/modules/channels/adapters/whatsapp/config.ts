/**
 * Zod schema for the WhatsApp channel's `channel_instances.config` JSONB blob.
 * Mirrors `WhatsAppChannelConfig` from `@vobase/core/adapters/channels/whatsapp/types`
 * — kept in sync manually because the core type isn't a Zod schema.
 *
 * Sensitive fields (accessToken, appSecret) are stored encrypted via the
 * `_integrations` vault; the row carries opaque references, not raw secrets.
 * For dev/local seeded rows the values may be inlined.
 */

import { z } from 'zod'

export const WhatsAppChannelConfigSchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  appSecret: z.string().min(1),
  webhookVerifyToken: z.string().min(1),
  appId: z.string().min(1).optional(),
  apiVersion: z.string().min(1).optional(),
})

export type WhatsAppChannelConfig = z.infer<typeof WhatsAppChannelConfigSchema>

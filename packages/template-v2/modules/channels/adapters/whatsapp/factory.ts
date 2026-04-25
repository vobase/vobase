/**
 * WhatsApp adapter factory — builds the core `ChannelAdapter` from a
 * `channel_instances.config` blob. The factory is the only place template
 * touches `@vobase/core/adapters/channels/whatsapp` directly.
 *
 * Dev fallback: when config fields are missing, fall back to env vars so the
 * seeded local instance still works without a complete config. Production
 * configs MUST carry the full shape.
 */

import type { ChannelAdapter, ChannelCapabilities } from '@vobase/core'
import { createWhatsAppAdapter } from '@vobase/core'

import { WhatsAppChannelConfigSchema } from './config'

export const WHATSAPP_CHANNEL_NAME = 'whatsapp'

export const WHATSAPP_CAPABILITIES: ChannelCapabilities = {
  templates: true,
  media: true,
  reactions: true,
  readReceipts: true,
  typingIndicators: true,
  streaming: false,
  messagingWindow: true,
}

function pick(...candidates: Array<string | undefined>): string {
  for (const c of candidates) {
    if (c && c.length > 0) return c
  }
  return ''
}

export function createWhatsAppAdapterFromConfig(
  rawConfig: Record<string, unknown>,
  _instanceId: string,
): ChannelAdapter {
  const partial = rawConfig as Partial<{
    phoneNumberId: string
    accessToken: string
    appSecret: string
    webhookVerifyToken: string
    appId: string
    apiVersion: string
  }>

  const merged = WhatsAppChannelConfigSchema.parse({
    phoneNumberId: pick(partial.phoneNumberId, process.env.WA_PHONE_NUMBER_ID),
    accessToken: pick(partial.accessToken, process.env.WA_ACCESS_TOKEN),
    // WA_WEBHOOK_SECRET is a legacy alias for WHATSAPP_APP_SECRET — Meta uses the
    // app secret to sign webhook payloads, so the same value powers both.
    appSecret: pick(partial.appSecret, process.env.WHATSAPP_APP_SECRET, process.env.WA_WEBHOOK_SECRET),
    webhookVerifyToken: pick(partial.webhookVerifyToken, process.env.WA_VERIFY_TOKEN),
    appId: partial.appId ?? process.env.WA_APP_ID,
    apiVersion: partial.apiVersion ?? process.env.WA_API_VERSION,
  })

  return createWhatsAppAdapter(merged)
}

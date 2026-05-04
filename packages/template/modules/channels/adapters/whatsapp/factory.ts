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
  nativeThreading: false,
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
    phoneNumberId: pick(partial.phoneNumberId, process.env.META_WA_PHONE_NUMBER_ID),
    accessToken: pick(partial.accessToken, process.env.META_WA_ACCESS_TOKEN, process.env.META_WA_TOKEN),
    appSecret: pick(partial.appSecret, process.env.META_WA_APP_SECRET),
    webhookVerifyToken: pick(partial.webhookVerifyToken, process.env.META_WA_VERIFY_TOKEN),
    appId: partial.appId ?? process.env.META_WA_APP_ID,
    apiVersion: partial.apiVersion ?? process.env.META_WA_API_VERSION,
  })

  return createWhatsAppAdapter(merged)
}

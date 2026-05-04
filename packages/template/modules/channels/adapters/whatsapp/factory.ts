/**
 * WhatsApp adapter factory — builds the core `ChannelAdapter` from a
 * `channel_instances.config` blob. The factory is the only place template
 * touches `@vobase/core/adapters/channels/whatsapp` directly.
 *
 * Dev fallback: when config fields are missing, fall back to env vars so the
 * seeded local instance still works without a complete config. Production
 * configs MUST carry the full shape.
 *
 * Managed mode (`config.mode === 'managed'`): all Graph calls + media
 * downloads route through the platform's `/api/managed-whatsapp/...` proxy
 * via the 2-key signed transport. Secrets come from the integrations vault.
 */

import { getVaultFor } from '@modules/integrations/service/registry'
import type { ChannelAdapter, ChannelCapabilities } from '@vobase/core'
import { createWhatsAppAdapter } from '@vobase/core'

import { WhatsAppChannelConfigSchema } from './config'
import { createManagedTransport } from './managed-transport'

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

interface ManagedConfig {
  mode: 'managed'
  platformChannelId: string
  platformBaseUrl: string
  organizationId: string
  phoneNumberId?: string
  wabaId?: string
  appSecret?: string
  appId?: string
  apiVersion?: string
}

function isManagedConfig(c: Record<string, unknown>): c is ManagedConfig & Record<string, unknown> {
  return (
    c.mode === 'managed' &&
    typeof c.platformChannelId === 'string' &&
    typeof c.platformBaseUrl === 'string' &&
    typeof c.organizationId === 'string'
  )
}

export function createWhatsAppAdapterFromConfig(
  rawConfig: Record<string, unknown>,
  _instanceId: string,
): ChannelAdapter {
  if (isManagedConfig(rawConfig)) {
    return createManagedAdapter(rawConfig)
  }

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

// ─── Managed-mode adapter ───────────────────────────────────────────────────

interface CachedRotation {
  current: { routineSecret: string; rotationKey: string; keyVersion: number }
  previous: { routineSecret: string; rotationKey: string; keyVersion: number; validUntil: Date } | null
}

function createManagedAdapter(config: ManagedConfig): ChannelAdapter {
  const tenantId = process.env.PLATFORM_TENANT_ID
  if (!tenantId) {
    throw new Error('whatsapp adapter (managed): PLATFORM_TENANT_ID env var is required')
  }

  const vault = getVaultFor(config.organizationId)
  let cached: CachedRotation | null = null
  let inflight: Promise<CachedRotation> | null = null

  function refresh(): Promise<CachedRotation> {
    if (inflight) return inflight
    const p = vault.readSecret('vobase-platform').then((rotation) => {
      if (!rotation) {
        inflight = null
        throw new Error('whatsapp adapter (managed): no vobase-platform secret in vault — handshake must run first')
      }
      cached = rotation as CachedRotation
      inflight = null
      return cached
    })
    inflight = p
    return p
  }

  // Warm the cache eagerly — outbound calls happen async so this resolves
  // before the adapter is exercised in normal operation.
  void refresh().catch(() => {
    // Surface the error on the next sign attempt rather than crashing init.
  })

  const transport = createManagedTransport({
    platformChannelId: config.platformChannelId,
    platformBaseUrl: config.platformBaseUrl,
    tenantId,
    get current() {
      if (!cached) {
        throw new Error('whatsapp adapter (managed): vault not yet loaded — outbound called before handshake completed')
      }
      return cached.current
    },
    get previous() {
      return cached?.previous ?? null
    },
  } as unknown as Parameters<typeof createManagedTransport>[0])

  return createWhatsAppAdapter({
    phoneNumberId: config.phoneNumberId ?? '',
    // Managed mode never holds the Meta bearer locally — the platform proxy
    // injects it. The adapter still needs a non-empty value to satisfy
    // internal assertions.
    accessToken: 'managed:proxy',
    appSecret: config.appSecret ?? 'managed:proxy',
    webhookVerifyToken: undefined,
    appId: config.appId,
    apiVersion: config.apiVersion,
    transport,
  })
}

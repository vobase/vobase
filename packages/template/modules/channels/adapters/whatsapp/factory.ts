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

import type { VaultRotation } from '@modules/integrations/service/vault'

/**
 * Module-level cache of decrypted vault rotations, keyed by organizationId.
 * The registry creates a new adapter per dispatch (`registry.get(...)`), so
 * caching inside the closure would never hit. Module-scope keeps the read at
 * O(1) per dispatch with a bounded TTL so a `vault.rotate(...)` propagates
 * within seconds.
 */
const ROTATION_CACHE_TTL_MS = 60_000
interface RotationCacheEntry {
  rotation: VaultRotation
  expiresAt: number
  inflight: Promise<VaultRotation> | null
}
const rotationCache = new Map<string, RotationCacheEntry>()

export function __resetManagedRotationCacheForTests(): void {
  rotationCache.clear()
}

async function loadRotation(organizationId: string): Promise<VaultRotation> {
  const now = Date.now()
  const entry = rotationCache.get(organizationId)
  if (entry?.inflight) return entry.inflight
  if (entry && entry.expiresAt > now) return entry.rotation

  const vault = getVaultFor(organizationId)
  const inflight = vault.readSecret('vobase-platform').then((rotation) => {
    if (!rotation) {
      rotationCache.delete(organizationId)
      throw new Error('whatsapp adapter (managed): no vobase-platform secret in vault — handshake must run first')
    }
    rotationCache.set(organizationId, {
      rotation,
      expiresAt: Date.now() + ROTATION_CACHE_TTL_MS,
      inflight: null,
    })
    return rotation
  })
  rotationCache.set(organizationId, {
    rotation:
      entry?.rotation ??
      ({ current: { routineSecret: '', rotationKey: '', keyVersion: 0 }, previous: null } as VaultRotation),
    expiresAt: 0,
    inflight,
  })
  return inflight
}

function createManagedAdapter(config: ManagedConfig): ChannelAdapter {
  const tenantId = process.env.PLATFORM_TENANT_ID
  if (!tenantId) {
    throw new Error('whatsapp adapter (managed): PLATFORM_TENANT_ID env var is required')
  }

  // Warm the cache eagerly so the first outbound dispatch doesn't pay the
  // vault round-trip. Failures surface on the next sign attempt.
  void loadRotation(config.organizationId).catch(() => {
    /* swallowed — re-thrown synchronously via the thunk below if cache miss */
  })

  function readCachedRotation(): VaultRotation {
    const entry = rotationCache.get(config.organizationId)
    if (!entry || entry.expiresAt === 0) {
      throw new Error('whatsapp adapter (managed): vault not yet loaded — outbound called before handshake completed')
    }
    return entry.rotation
  }

  const transport = createManagedTransport({
    platformChannelId: config.platformChannelId,
    platformBaseUrl: config.platformBaseUrl,
    tenantId,
    current: () => readCachedRotation().current,
    previous: () => readCachedRotation().previous,
  })

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

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

import { findKind, type ManagedChannelKind } from '@modules/channels/managed/registry'
import { getVaultFor } from '@modules/integrations/service/registry'
import type { VaultProvider } from '@modules/integrations/service/vault'
import { deriveVerifyToken } from '@modules/integrations/service/verify-token'
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
  /** Indicative env label — passed through to verify-token derivation. */
  environment?: 'production' | 'staging' | string
  /**
   * Channel-kind discriminator from the managed-channels registry
   * (`modules/channels/managed/registry.ts`). Written by `claimAndBootstrap`;
   * absent on rows created before US-011 (sandbox-only world — fall back to
   * `'sandbox'` and the vault provider stays `'vobase-platform'`).
   */
  kind?: ManagedChannelKind
  /**
   * Platform-minted webhook endpoint id. Written by the webhook-register
   * handler after a successful `/link` registration; used to encode the QR
   * deeplink on the tenant side. Absent on rows created before the v3
   * webhook-endpoints contract.
   */
  endpointId?: string
}

export function isManagedConfig(c: Record<string, unknown>): c is ManagedConfig & Record<string, unknown> {
  return (
    c.mode === 'managed' &&
    typeof c.platformChannelId === 'string' &&
    typeof c.platformBaseUrl === 'string' &&
    typeof c.organizationId === 'string'
  )
}

// biome-ignore lint/suspicious/useAwait: managed branch awaits internally; sync branch keeps contract uniform
export async function createWhatsAppAdapterFromConfig(
  rawConfig: Record<string, unknown>,
  _instanceId: string,
): Promise<ChannelAdapter> {
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
 * Module-level cache of decrypted vault rotations, keyed by
 * `${organizationId}:${vaultProvider}`. The registry creates a new adapter
 * per dispatch (`registry.get(...)`), so caching inside the closure would
 * never hit. Module-scope keeps the read at O(1) per dispatch with a bounded
 * TTL so a `vault.rotate(...)` propagates within seconds.
 */
const ROTATION_CACHE_TTL_MS = 60_000
interface RotationCacheEntry {
  rotation: VaultRotation
  expiresAt: number
  inflight: Promise<VaultRotation> | null
}
const rotationCache = new Map<string, RotationCacheEntry>()

/**
 * Compose the rotation-cache key. Slice 2 keyed the cache by `organizationId`
 * alone, which collides as soon as a second `vaultProvider` lands on the
 * same org — the second `loadRotation` would return the first provider's
 * material. Including the provider in the key keeps both tiers cached
 * side-by-side without clobbering one another.
 */
function rotationCacheKey(organizationId: string, vaultProvider: VaultProvider): string {
  return `${organizationId}:${vaultProvider}`
}

export function __resetManagedRotationCacheForTests(): void {
  rotationCache.clear()
}

/**
 * Resolve the managed-channels registry entry for a config. Reads
 * `config.kind` (written by `claimAndBootstrap` per US-011); rows minted
 * before US-011 have no `kind` — fall back to `'sandbox'`, which today
 * still resolves to `'vobase-platform'` so the migration is byte-stable.
 * `vaultProvider`, `channelName` (= webhook provider salt), etc. all come
 * from this single lookup.
 */
function resolveKindSpec(config: ManagedConfig) {
  return findKind(config.kind ?? 'sandbox')
}

// biome-ignore lint/suspicious/useAwait: signature kept Promise-returning so callers don't need to branch on cache hit vs miss
async function loadRotation(organizationId: string, vaultProvider: VaultProvider): Promise<VaultRotation> {
  const now = Date.now()
  const cacheKey = rotationCacheKey(organizationId, vaultProvider)
  const entry = rotationCache.get(cacheKey)
  if (entry?.inflight) return entry.inflight
  if (entry && entry.expiresAt > now) return entry.rotation

  const vault = getVaultFor(organizationId)
  const inflight = vault.readSecret(vaultProvider).then((rotation) => {
    if (!rotation) {
      rotationCache.delete(cacheKey)
      throw new Error(`whatsapp adapter (managed): no '${vaultProvider}' secret in vault — handshake must run first`)
    }
    rotationCache.set(cacheKey, {
      rotation,
      expiresAt: Date.now() + ROTATION_CACHE_TTL_MS,
      inflight: null,
    })
    return rotation
  })
  rotationCache.set(cacheKey, {
    rotation:
      entry?.rotation ??
      ({ current: { routineSecret: '', rotationKey: '', keyVersion: 0 }, previous: null } as VaultRotation),
    expiresAt: 0,
    inflight,
  })
  return inflight
}

async function createManagedAdapter(config: ManagedConfig): Promise<ChannelAdapter> {
  // X-Tenant-Id for outbound platform calls = tenants.id (nanoid).
  // tenantSlug below stays for deriveVerifyToken so both ends of the
  // WhatsApp webhook verify derivation continue to agree on the slug.
  const tenantId = process.env.PLATFORM_TENANT_ID
  const tenantSlug = process.env.VITE_PLATFORM_TENANT_SLUG
  if (!tenantId) {
    throw new Error('whatsapp adapter (managed): PLATFORM_TENANT_ID env var is required')
  }
  if (!tenantSlug) {
    throw new Error('whatsapp adapter (managed): VITE_PLATFORM_TENANT_SLUG env var is required')
  }

  // Consult the managed-channels registry once at adapter construction so
  // a new `(kind, vaultProvider, channelName)` triple plugs in without
  // touching this file.
  const kindSpec = resolveKindSpec(config)
  const vaultProvider = kindSpec.vaultProvider

  // Await the initial vault load so that the first outbound dispatch never
  // races the cold load. `loadRotation` deduplicates concurrent calls via the
  // inflight cache entry, so subsequent adapter constructions for the same org
  // within the TTL window pay only an in-memory cache hit.
  await loadRotation(config.organizationId, vaultProvider)

  const cacheKey = rotationCacheKey(config.organizationId, vaultProvider)
  function readCachedRotation(): VaultRotation {
    const entry = rotationCache.get(cacheKey)
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
    // Inbound webhooks can race a TTL expiry. Awaiting the load (which dedups
    // via the inflight cache entry) before the verifier resolves the sync
    // thunks ensures the first inbound after a cache miss succeeds.
    ensureReady: async () => {
      await loadRotation(config.organizationId, vaultProvider)
    },
  })

  // Derive the verify token deterministically from BETTER_AUTH_SECRET so the
  // GET hub challenge handler answers correctly when the platform validates
  // the registered webhook URL. Same derivation runs at registration time
  // (modules/integrations/module.ts) — by tying both ends to the same KEK
  // they always agree without coordination. Falls back to undefined when the
  // secret isn't set; the GET handler then 403s the challenge but the
  // adapter still works for outbound (managed mode doesn't use this token
  // for anything else).
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET
  const environment = (config.environment as 'production' | 'staging' | undefined) ?? 'production'
  // The provider salt MUST match what the platform registration side used
  // (see `claimAndBootstrap`'s `registerWebhookWithPlatform` call, which
  // sources the literal from `kindSpec.channelName`). Hardcoding `'whatsapp'`
  // here would silently 403 the notification webhook's hub challenge.
  const webhookVerifyToken = betterAuthSecret
    ? deriveVerifyToken({
        tenantSlug,
        environment,
        provider: kindSpec.channelName,
        betterAuthSecret,
      })
    : undefined

  return createWhatsAppAdapter({
    phoneNumberId: config.phoneNumberId ?? '',
    // Managed mode never holds the Meta bearer locally — the platform proxy
    // injects it. The adapter still needs a non-empty value to satisfy
    // internal assertions.
    accessToken: 'managed:proxy',
    appSecret: config.appSecret ?? 'managed:proxy',
    webhookVerifyToken,
    appId: config.appId,
    apiVersion: config.apiVersion,
    transport,
  })
}

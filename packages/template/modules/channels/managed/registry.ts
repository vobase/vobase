/** @contract platform-tenant-v1 */
/**
 * channels/managed/registry — channel-kind catalog (per §4.1, tenant side).
 *
 * One record per platform-pool kind. Today only `sandbox` exists — the
 * registry is the single extension point so `handshake.ts`, `factory.ts`, and
 * `bootstrap.ts` consult it instead of branching on `kind`.
 *
 * BYO WhatsApp is intentionally NOT a registry entry (see §7.3 + §4.8) —
 * it follows a parallel oauth-proxy/whatsapp-setup-job flow.
 *
 * The platform side carries a parallel registry at
 * `vobase-platform/modules/managed-whatsapp/registry.ts`. Both repos must
 * agree on `kind` strings; the tenant side additionally pins
 * `vaultProvider` so the WhatsApp factory can pick the correct vault key
 * without hardcoding a literal at every call site.
 */

import type { VaultProvider } from '@modules/integrations/service/vault'

/** Union of all registered channel kinds. Widen when adding a new entry. */
export type ManagedChannelKind = 'sandbox'

/**
 * Inbound dispatch discriminator. Each kind tells the registry-driven router
 * which downstream branch to take when a verified webhook lands. Today the
 * only entry is `'customer'` — sandbox-tier inbound flows through the
 * existing customer-WA webhook router, not the registry-driven router (so
 * the value is reserved; the registry-driven router 410s when it sees it).
 */
export type InboundDispatch = 'customer'

export interface ChannelKind {
  readonly kind: ManagedChannelKind
  readonly vaultProvider: VaultProvider
  /**
   * Platform endpoint path for the claim handshake. Each kind owns its own
   * path so `handshake.ts` never grows a switch on `kind`.
   */
  readonly claimPath: string
  /**
   * Platform endpoint path for the tenant-initiated release of a claim.
   * Mirrors `claimPath` shape per kind.
   */
  readonly releasePath: string
  /**
   * Channel-instance row `channel` discriminator — the value persisted in
   * `channel_instances.channel`. The inbound router looks up channels by
   * (orgId, channelName) given a kind.
   */
  readonly channelName: string
  /**
   * Channel-instance row `role` — `'customer'` for sandbox.
   */
  readonly role: 'customer' | 'staff'
  /**
   * `channel_instances.config.mode` discriminator written at claim time.
   * `'managed'` for sandbox (customer-facing). Threading it through the
   * registry keeps `bootstrap.ts` kind-agnostic.
   */
  readonly instanceMode: 'managed'
  /**
   * Human-readable label written into `channel_instances.displayName` at
   * claim time. Defaulted from the registry so `bootstrap.ts` doesn't have
   * to branch on `kind`; callers can still override per-org via the
   * `displayName` opts field.
   */
  readonly displayLabel: string
  /**
   * Downstream-dispatch tag. The registry-driven inbound router branches on
   * this without ever switching on `kind` directly.
   */
  readonly inboundDispatch: InboundDispatch
  readonly description: string
}

export const KINDS: readonly ChannelKind[] = [
  {
    kind: 'sandbox',
    vaultProvider: 'vobase-platform',
    claimPath: '/api/managed-whatsapp/sandbox/create',
    releasePath: '/api/managed-whatsapp/tenant/release',
    channelName: 'whatsapp',
    role: 'customer',
    instanceMode: 'managed',
    displayLabel: 'Platform sandbox',
    inboundDispatch: 'customer',
    description: 'Pooled platform-managed sandbox WhatsApp number. Tenant fetches secrets via vobase-platform vault.',
  },
] as const

export function findKind(kind: string): ChannelKind {
  const k = KINDS.find((x) => x.kind === kind)
  if (!k) throw new Error(`unknown channel kind: ${kind}`)
  return k
}

/**
 * Look up a registry entry by its persisted `channelName` (the value stored
 * in `channel_instances.channel`). The inbound router uses this to translate
 * a row's channel discriminator back into the registry's dispatch metadata.
 */
export function findByChannelName(channelName: string): ChannelKind | null {
  return KINDS.find((x) => x.channelName === channelName) ?? null
}

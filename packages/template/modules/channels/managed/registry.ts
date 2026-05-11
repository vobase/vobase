/** @contract platform-tenant-v1 */
/**
 * channels/managed/registry — channel-kind catalog (per §4.1, tenant side).
 *
 * One record per platform-pool kind. Today only `sandbox`. The §4.1 design
 * additionally covers a `notification` kind that lands in Slice 3 — do NOT
 * add it here ahead of time; the registry is the single extension point and
 * adding a kind is what unlocks the rest of the factory + handshake +
 * bootstrap paths consulting it.
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

export interface ChannelKind {
  readonly kind: 'sandbox' // expand to union when more kinds land
  readonly vaultProvider: VaultProvider
  readonly description: string
}

export const KINDS: readonly ChannelKind[] = [
  {
    kind: 'sandbox',
    vaultProvider: 'vobase-platform',
    description: 'Pooled platform-managed sandbox WhatsApp number. Tenant fetches secrets via vobase-platform vault.',
  },
] as const

export function findKind(kind: string): ChannelKind {
  const k = KINDS.find((x) => x.kind === kind)
  if (!k) throw new Error(`unknown channel kind: ${kind}`)
  return k
}

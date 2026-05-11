/** @contract platform-tenant-v1 */
/**
 * channels/managed/registry — channel-kind catalog (per §4.1, tenant side).
 *
 * One record per platform-pool kind. Slice 2 introduced `sandbox`; Slice 3
 * adds `notification` for staff-facing managed numbers. The registry is the
 * single extension point — `handshake.ts`, `factory.ts`, and `bootstrap.ts`
 * consult it instead of branching on `kind`, so a new kind plugs in via one
 * record here.
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
export type ManagedChannelKind = 'sandbox' | 'notification'

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
  readonly description: string
}

export const KINDS: readonly ChannelKind[] = [
  {
    kind: 'sandbox',
    vaultProvider: 'vobase-platform',
    claimPath: '/api/managed-whatsapp/sandbox/create',
    releasePath: '/api/managed-whatsapp/tenant/release',
    description: 'Pooled platform-managed sandbox WhatsApp number. Tenant fetches secrets via vobase-platform vault.',
  },
  {
    kind: 'notification',
    vaultProvider: 'vobase-platform-notification',
    claimPath: '/api/managed-whatsapp/notification/claim',
    releasePath: '/api/managed-whatsapp/notification/release',
    description:
      'Pooled platform-managed staff-notification WhatsApp number. Inbound from linked staff phones dispatches as `staff_reply`.',
  },
] as const

export function findKind(kind: string): ChannelKind {
  const k = KINDS.find((x) => x.kind === kind)
  if (!k) throw new Error(`unknown channel kind: ${kind}`)
  return k
}

/**
 * Per-org magic-link endpoint id lookup. Reads the `magicLinkEndpointId`
 * `org_settings` key — the platform-minted endpoint id registered at
 * notification-channel claim time so the magic-link finish webhook the
 * platform calls is tied to this tenant.
 *
 * Magic-link is per-deployment auth infrastructure, not a channel, so the
 * endpoint id lives in `org_settings` rather than on a channel row.
 *
 * One-off `auth/` → `@modules/` import: required because the magic-link
 * endpoint id is a per-org DB value. Architect-approved; do not add further
 * such imports.
 *
 * Throws `MagicLinkMintError('magic_link_endpoint_unconfigured')` when the
 * key is missing so callers' existing catch path records a failed run
 * instead of minting against a phantom endpoint.
 */

import { orgSettings } from '@modules/settings/schema'
import { and, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { MagicLinkMintError } from './magic-link'

let _override: string | null = null

/** Test-only override seam — bypasses the DB lookup entirely. */
export function __setMagicLinkEndpointIdForTests(id: string | null): void {
  _override = id
}

export async function getMagicLinkEndpointId(db: ScopedDb, organizationId: string): Promise<string> {
  if (_override !== null) return _override
  const rows = await db
    .select({ value: orgSettings.value })
    .from(orgSettings)
    .where(and(eq(orgSettings.organizationId, organizationId), eq(orgSettings.key, 'magicLinkEndpointId')))
    .limit(1)
  const id = rows[0]?.value
  if (!id) {
    throw new MagicLinkMintError('magic_link_endpoint_unconfigured')
  }
  return id
}

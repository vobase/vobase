/**
 * Per-org magic-link endpoint id lookup. Reads from
 * `channels.notification_settings.magicLinkEndpointId` — the platform-minted
 * endpoint id registered at install time so the magic-link finish webhook
 * the platform calls is tied to this tenant.
 *
 * One-off `auth/` → `@modules/` import: required because the magic-link
 * endpoint id moved from a process-wide env var to a per-org DB column.
 * Architect-approved; do not add further such imports.
 *
 * Throws `MagicLinkMintError('magic_link_endpoint_unconfigured')` when the
 * row or column is missing so callers' existing catch path records a failed
 * run instead of minting against a phantom endpoint.
 */

import { getNotificationSettings } from '@modules/channels/service/notification-settings'

import type { ScopedDb } from '~/runtime'
import { MagicLinkMintError } from './magic-link'

let _override: string | null = null

/** Test-only override seam — bypasses the DB lookup entirely. */
export function __setMagicLinkEndpointIdForTests(id: string | null): void {
  _override = id
}

export async function getMagicLinkEndpointId(db: ScopedDb, organizationId: string): Promise<string> {
  if (_override !== null) return _override
  const row = await getNotificationSettings(db, organizationId)
  if (!row?.magicLinkEndpointId) {
    throw new MagicLinkMintError('magic_link_endpoint_unconfigured')
  }
  return row.magicLinkEndpointId
}

import { MagicLinkMintError } from './magic-link'

/**
 * Returns the platform-registered endpoint id for this tenant's magic-link
 * finish route. Configured via MAGIC_LINK_ENDPOINT_ID env (output of
 * `POST /api/provisioning/webhook-endpoints/register` with provider='magic_link').
 *
 * Throws MagicLinkMintError('magic_link_endpoint_unconfigured') when missing
 * so callers' existing MagicLinkMintError catch path records a failed run.
 */
export function getMagicLinkEndpointId(): string {
  const id = process.env.MAGIC_LINK_ENDPOINT_ID?.trim() ?? ''
  if (!id) {
    throw new MagicLinkMintError('magic_link_endpoint_unconfigured')
  }
  return id
}

/** Test-only override seam (parallel to other env-config helpers in this codebase). */
let _override: string | null = null
export function __setMagicLinkEndpointIdForTests(id: string | null): void {
  _override = id
}
export function readMagicLinkEndpointIdOrNull(): string | null {
  if (_override !== null) return _override
  const id = process.env.MAGIC_LINK_ENDPOINT_ID?.trim() ?? ''
  return id || null
}

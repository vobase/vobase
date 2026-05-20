/**
 * Resolve the app's public base URL — the host webhook + magic-link callbacks
 * point at. Standalone leaf module (imports nothing) so `auth/` can use it
 * without the `auth ← runtime ← auth` cycle the `~/runtime` barrel would create.
 */

/** Trailing slash stripped. Throws in production when no base URL is configured. */
export function readAppBaseUrl(): string {
  const url = process.env.PUBLIC_BASE_URL?.trim() ?? process.env.WEBHOOK_BASE_URL?.trim() ?? ''
  if (url) return url.replace(/\/$/, '')
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_BASE_URL must be set in production for webhook + magic-link callbacks')
  }
  return `http://localhost:${process.env.PORT ?? '3001'}`
}

import type { Context } from 'hono'

/**
 * Extract the hex body of an `x-hub-signature-256: sha256=<hex>` header.
 * Returns the raw header value when the `sha256=` prefix is absent.
 */
export function parseHubSignature(c: Context): string {
  const raw = c.req.header('x-hub-signature-256') ?? ''
  return raw.startsWith('sha256=') ? raw.slice(7) : raw
}

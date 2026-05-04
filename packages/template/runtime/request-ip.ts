/**
 * Source-IP determination from incoming HTTP requests.
 *
 * `X-Forwarded-For` is trivially spoofable — clients can send any value, and
 * naïve `xff.split(',')[0]` parsers trust the leftmost entry, which is the
 * one furthest from the trust boundary. The correct read is "the entry
 * `TRUST_PROXY_HOPS` from the right", since each trusted hop appends the IP
 * it observed.
 *
 *   TRUST_PROXY_HOPS=0  → ignore XFF entirely; fall back to peer / x-real-ip.
 *                         (Default — safest when running directly behind no
 *                         proxy, or when the proxy chain hasn't been audited.)
 *   TRUST_PROXY_HOPS=1  → trust the rightmost XFF entry. Use when there is
 *                         exactly one trusted reverse-proxy in front (e.g.
 *                         Railway's edge, Cloudflare in front of an origin
 *                         with no other hop).
 *   TRUST_PROXY_HOPS=N  → trust the Nth-from-right entry (multiple proxies).
 *
 * `x-real-ip` is honored as a fallback because some PaaS edges set it
 * directly. The connection-peer IP is not available from a Hono `Headers`
 * argument; callers that have access to a Bun socket can pass it via
 * `peerIp`. Without `peerIp` we surface `'unknown'` rather than guess.
 */

const TRUST_PROXY_HOPS_ENV = 'TRUST_PROXY_HOPS'

function trustHops(): number {
  const raw = process.env[TRUST_PROXY_HOPS_ENV]
  if (raw === undefined || raw === '') return 0
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export interface SourceIpInput {
  /** Connection peer IP from the underlying socket, when available. */
  peerIp?: string | null
}

/**
 * Returns the best-guess client IP for `headers`, applying the
 * `TRUST_PROXY_HOPS` policy described above. `'unknown'` when no usable
 * source is available — never throws.
 */
export function sourceIpFromHeaders(headers: Headers, input: SourceIpInput = {}): string {
  const hops = trustHops()
  if (hops > 0) {
    const xff = headers.get('x-forwarded-for')
    if (xff) {
      const parts = xff
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      // Right-most entry was inserted by our edge; we trust `hops` entries
      // from the right. `parts.length - hops` selects "the IP `hops` proxies
      // ago saw" which is the closest non-spoofable client identity.
      const idx = parts.length - hops
      const candidate = idx >= 0 ? parts[idx] : parts[0]
      if (candidate && candidate.length > 0) return candidate
    }
  }
  const real = headers.get('x-real-ip')?.trim()
  if (real && real.length > 0) return real
  if (input.peerIp && input.peerIp.length > 0) return input.peerIp
  return 'unknown'
}

/**
 * HMAC signing helper for integration tests against the magic-verify-plugin endpoints.
 *
 * Mirrors the extended v2 canonical payload used by auth/magic-verify-plugin.ts:
 *   `${method}|${pathOnly}|${sortedQuery}|${bodyDigest}|${timestamp}`
 *
 * The platform (vobase-platform) uses the same contract when calling
 * /api/auth/verify-magic-link and /api/auth/set-active-organization.
 */

import { createHash } from 'node:crypto'
import { signRequest } from '@vobase/core'

export interface HmacSignOpts {
  method: 'POST' | 'GET'
  /** Full path including optional query string, e.g. '/api/auth/verify-magic-link' */
  path: string
  body: string
  /** Unix milliseconds timestamp to embed in X-Vobase-Timestamp. Pass Date.now() for valid requests. */
  timestampMs: number
  secret: string
}

export interface HmacSignResult {
  headers: Record<string, string>
  bodyDigest: string
  canonical: string
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function sortQueryString(rawQuery: string): string {
  if (!rawQuery) return ''
  const params = new URLSearchParams(rawQuery)
  const entries = [...params.entries()]
  entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
  const sorted = new URLSearchParams()
  for (const [k, v] of entries) sorted.append(k, v)
  return sorted.toString()
}

/**
 * Build the extended v2 HMAC headers for a request to a magic-verify endpoint.
 *
 * The canonical payload is 5 segments (extended v2):
 *   `${method}|${pathOnly}|${sortedQuery}|${bodyDigest}|${timestamp}`
 *
 * Note: standard v2 (managed-whatsapp) is 4 segments without the timestamp.
 * Auth-magic endpoints use the 5-segment form for replay protection.
 */
export function signTestHmac(opts: HmacSignOpts): HmacSignResult {
  const { method, path, body, timestampMs, secret } = opts

  const bodyDigest = sha256Hex(body)
  const timestamp = String(timestampMs)

  let pathOnly: string
  let sortedQuery: string
  try {
    const url = new URL(path, 'http://localhost')
    pathOnly = url.pathname
    sortedQuery = sortQueryString(url.search.slice(1))
  } catch {
    pathOnly = path
    sortedQuery = ''
  }

  // Extended v2: 5-segment canonical payload
  const canonical = `${method}|${pathOnly}|${sortedQuery}|${bodyDigest}|${timestamp}`

  const signed = signRequest({
    body: canonical,
    routineSecret: secret,
    rotationKey: secret,
    keyVersion: 1,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Vobase-Sig-Version': '2',
    'X-Vobase-Routine-Sig': signed.routineSignature,
    'X-Vobase-Rotation-Sig': signed.rotationSignature,
    'X-Vobase-Key-Version': String(signed.keyVersion),
    'X-Vobase-Body-Digest': bodyDigest,
    'X-Vobase-Timestamp': timestamp,
  }

  return { headers, bodyDigest, canonical }
}

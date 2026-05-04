/**
 * Tenant-side handshake against the platform's `/sandbox/create` endpoint.
 *
 * Single owner of the platform-facing IO for managed-channel provisioning —
 * keeps `signRequest` + tenant-id headers + base-URL allowlist in one place
 * so handlers + auto-provisioner + tests don't reimplement it.
 */

import { type SignedRequest, signHmac, signRequest } from '@vobase/core'

import { sha256Hex, splitPathAndQuery } from '../../channels/adapters/whatsapp/managed-transport'

const META_PLATFORM_HOSTNAME_ALLOWLIST_ENV = 'META_PLATFORM_HOSTNAME_ALLOWLIST'

let allowlistCache: { raw: string; hosts: ReadonlySet<string> } | null = null

function platformHostAllowlist(): ReadonlySet<string> {
  const raw = process.env[META_PLATFORM_HOSTNAME_ALLOWLIST_ENV] ?? ''
  if (!allowlistCache || allowlistCache.raw !== raw) {
    const hosts = new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    allowlistCache = { raw, hosts }
  }
  return allowlistCache.hosts
}

export interface HandshakeAllocation {
  platformChannelId: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string
  routineSecret: string
  rotationKey: string
  keyVersion: number
  routineSecretPrevious: string | null
  rotationKeyPrevious: string | null
  previousValidUntil: string | null
}

export class PlatformHandshakeError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'PlatformHandshakeError'
  }
}

/**
 * Validate that a `platformBaseUrl` is in the env-configured allowlist. The
 * allowlist defends against a compromised platform-→-tenant control payload
 * pointing the tenant at an attacker-controlled platform URL.
 */
export function isAllowedPlatformBaseUrl(platformBaseUrl: string): boolean {
  let host: string
  try {
    host = new URL(platformBaseUrl).hostname
  } catch {
    return false
  }
  const hosts = platformHostAllowlist()
  if (hosts.size === 0) {
    // No allowlist configured → only allow localhost (dev) by default; refuse
    // any external host. Deployments MUST set the env var explicitly.
    return host === 'localhost' || host === '127.0.0.1'
  }
  return hosts.has(host)
}

interface HandshakeInput {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  environment: 'production' | 'staging'
  channelInstanceId: string
}

interface SignedPlatformPostInput {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
}

/**
 * Sign + POST a JSON body to a platform path on behalf of `tenantId`. Both the
 * legacy single-key `X-Platform-Signature` header (used by un-upgraded
 * platforms) and the 2-key headers (used by upgraded platforms) are sent so
 * either side can roll forward independently. Hostname is validated against
 * the env allowlist before the request leaves the process.
 */
async function signedPlatformPost(
  path: string,
  body: string,
  input: SignedPlatformPostInput,
): Promise<{ res: Response; signed: SignedRequest }> {
  if (!isAllowedPlatformBaseUrl(input.platformBaseUrl)) {
    throw new PlatformHandshakeError(
      `platformBaseUrl '${input.platformBaseUrl}' is not in META_PLATFORM_HOSTNAME_ALLOWLIST`,
      null,
      'platform_url_not_allowed',
    )
  }

  const url = `${input.platformBaseUrl.replace(/\/$/, '')}${path}`
  const { pathOnly, sortedQuery } = splitPathAndQuery(path)
  const bodyDigest = sha256Hex(body)
  const v2Payload = `POST|${pathOnly}|${sortedQuery}|${bodyDigest}`
  const signed = signRequest({
    body: v2Payload,
    routineSecret: input.tenantHmacSecret,
    rotationKey: input.tenantHmacSecret,
    keyVersion: 1,
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': input.tenantId,
      // legacy v1 — keep until platform's MANAGED_REQUIRE_SIG_V2=true rollout finishes
      'X-Platform-Signature': signHmac(body, input.tenantHmacSecret),
      // v2 contract
      'X-Vobase-Routine-Sig': signed.routineSignature,
      'X-Vobase-Rotation-Sig': signed.rotationSignature,
      'X-Vobase-Key-Version': String(signed.keyVersion),
      'X-Vobase-Sig-Version': '2',
      'X-Vobase-Body-Digest': bodyDigest,
    },
    body,
  })
  return { res, signed }
}

/**
 * Call the platform's `POST /api/managed-whatsapp/sandbox/create` over the
 * 2-key signed contract. Returns the sandbox-pool allocation. Throws
 * `PlatformHandshakeError` on transport / auth / pool-exhausted errors.
 */
export async function handshakeWithPlatform(input: HandshakeInput): Promise<HandshakeAllocation> {
  const body = JSON.stringify({
    environment: input.environment,
    channelInstanceId: input.channelInstanceId,
  })
  const { res } = await signedPlatformPost('/api/managed-whatsapp/sandbox/create', body, input)

  if (!res.ok) {
    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    const code = (payload as { code?: string } | null)?.code
    throw new PlatformHandshakeError(`platform handshake failed (${res.status})`, res.status, code)
  }

  const data = (await res.json()) as HandshakeAllocation
  return data
}

/** Tenant-initiated release of own managed link. Mirrors handshake's signing path. */
export async function releaseWithPlatform(input: {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  environment: 'production' | 'staging'
}): Promise<{ released: boolean }> {
  const body = JSON.stringify({ environment: input.environment })
  const { res } = await signedPlatformPost('/api/managed-whatsapp/tenant/release', body, input)
  if (!res.ok) {
    throw new PlatformHandshakeError(`platform release failed (${res.status})`, res.status)
  }
  return (await res.json()) as { released: boolean }
}

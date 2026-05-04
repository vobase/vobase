/**
 * Tenant-side handshake against the platform's `/sandbox/create` endpoint.
 *
 * Single owner of the platform-facing IO for managed-channel provisioning —
 * keeps `signRequest` + tenant-id headers + base-URL allowlist in one place
 * so handlers + auto-provisioner + tests don't reimplement it.
 */

import { signRequest } from '@vobase/core'

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

/**
 * Call the platform's `POST /api/managed-whatsapp/sandbox/create` over the
 * 2-key signed contract. Returns the sandbox-pool allocation. Throws
 * `PlatformHandshakeError` on transport / auth / pool-exhausted errors.
 */
export async function handshakeWithPlatform(input: HandshakeInput): Promise<HandshakeAllocation> {
  if (!isAllowedPlatformBaseUrl(input.platformBaseUrl)) {
    throw new PlatformHandshakeError(
      `platformBaseUrl '${input.platformBaseUrl}' is not in META_PLATFORM_HOSTNAME_ALLOWLIST`,
      null,
      'platform_url_not_allowed',
    )
  }

  const url = `${input.platformBaseUrl.replace(/\/$/, '')}/api/managed-whatsapp/sandbox/create`
  const body = JSON.stringify({
    environment: input.environment,
    channelInstanceId: input.channelInstanceId,
  })

  // Tenant-→-platform legacy contract uses one shared HMAC secret +
  // X-Platform-Signature over body. We sign the body with both 2-key
  // signatures too so the upgraded platform can transparently roll forward.
  const signed = signRequest({
    body,
    routineSecret: input.tenantHmacSecret,
    rotationKey: input.tenantHmacSecret,
    keyVersion: 1,
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': input.tenantId,
      'X-Platform-Signature': signed.routineSignature,
      'X-Vobase-Routine-Sig': signed.routineSignature,
      'X-Vobase-Rotation-Sig': signed.rotationSignature,
      'X-Vobase-Key-Version': String(signed.keyVersion),
    },
    body,
  })

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
  if (!isAllowedPlatformBaseUrl(input.platformBaseUrl)) {
    throw new PlatformHandshakeError(
      `platformBaseUrl '${input.platformBaseUrl}' is not in META_PLATFORM_HOSTNAME_ALLOWLIST`,
      null,
      'platform_url_not_allowed',
    )
  }

  const url = `${input.platformBaseUrl.replace(/\/$/, '')}/api/managed-whatsapp/tenant/release`
  const body = JSON.stringify({ environment: input.environment })
  const signed = signRequest({
    body,
    routineSecret: input.tenantHmacSecret,
    rotationKey: input.tenantHmacSecret,
    keyVersion: 1,
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': input.tenantId,
      'X-Platform-Signature': signed.routineSignature,
    },
    body,
  })
  if (!res.ok) {
    throw new PlatformHandshakeError(`platform release failed (${res.status})`, res.status)
  }
  return (await res.json()) as { released: boolean }
}

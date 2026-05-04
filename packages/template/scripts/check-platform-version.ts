/**
 * Cross-repo merge gate — verifies the configured platform deploy advertises
 * a managed-channels schemaVersion ≥ what this template expects.
 *
 * Usage: `bun run check:platform-version`
 *
 * Reads `META_PLATFORM_HEALTH_URL` (e.g. `https://platform.staging.voltade.app/api/managed-whatsapp/health`)
 * and `META_PLATFORM_REQUIRED_SCHEMA_VERSION` (default: `sandbox-v1`).
 *
 * Skipped when the URL is unset (so local builds + CI without the env
 * configured don't hard-fail). The check is enforced on the cross-repo E2E
 * smoke job that explicitly sets these env vars.
 */

export {}

const REQUIRED_ENV = 'META_PLATFORM_HEALTH_URL'
const REQUIRED_SCHEMA_ENV = 'META_PLATFORM_REQUIRED_SCHEMA_VERSION'
const DEFAULT_REQUIRED_SCHEMA = 'sandbox-v1'

const url = process.env[REQUIRED_ENV]
if (!url) {
  console.log(`[check:platform-version] ${REQUIRED_ENV} not set — skipping cross-repo gate`)
  process.exit(0)
}

const required = process.env[REQUIRED_SCHEMA_ENV] ?? DEFAULT_REQUIRED_SCHEMA

let res: Response
try {
  res = await fetch(url, {
    method: 'GET',
    headers: process.env.PLATFORM_ADMIN_KEY ? { Authorization: `Bearer ${process.env.PLATFORM_ADMIN_KEY}` } : undefined,
  })
} catch (err) {
  console.error(`[check:platform-version] failed to reach ${url}:`, err)
  process.exit(1)
}

if (!res.ok) {
  console.error(`[check:platform-version] ${url} returned ${res.status}`)
  process.exit(1)
}

const body = (await res.json()) as { schemaVersion?: string; version?: string; ok?: boolean }
const advertised = body.schemaVersion ?? body.version
if (!advertised) {
  console.error(
    `[check:platform-version] platform health response missing schemaVersion — auth may be insufficient (anonymous callers get only { ok: true }). Set PLATFORM_ADMIN_KEY or X-Tenant-Id headers.`,
  )
  process.exit(1)
}

if (advertised !== required) {
  console.error(`[check:platform-version] schema mismatch: required=${required}, platform advertises=${advertised}`)
  process.exit(1)
}

console.log(`[check:platform-version] ✓ platform schemaVersion=${advertised} matches required=${required}`)
process.exit(0)

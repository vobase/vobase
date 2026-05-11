/**
 * Managed-mode WhatsApp control-plane endpoints (auth-gated, per-org).
 *
 * Routes:
 *   - GET    /managed/availability         — sandbox pool availability count (from platform /health)
 *   - POST   /managed/claim                — claim a sandbox channel from the platform pool
 *   - DELETE /managed/:instanceId          — release the channel back to the platform pool
 *   - GET    /managed/:instanceId/webhook  — proxy this channel's webhook registration status
 *   - POST   /managed/:instanceId/webhook/re-verify
 *                                          — re-trigger the platform challenge
 *                                            against the registered URL (debugging aid)
 *
 * The webhook endpoints proxy signed requests to the platform's
 * `/api/provisioning/webhook-endpoints/*` so the frontend can render +
 * refresh registration status without holding the HMAC secret in the bundle.
 *
 * `claim` replaces the legacy boot-time auto-provision: a tenant operator
 * clicks "Claim sandbox" in the UI and the same handshake + vault store +
 * channel-instances upsert + webhook self-register sequence runs
 * synchronously inside the request.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { isManagedConfig } from '@modules/channels/adapters/whatsapp/factory'
import { claimAndBootstrap } from '@modules/channels/managed/bootstrap'
import { getInstance, listInstances, removeInstance, upsertManagedInstance } from '@modules/channels/service/instances'
import {
  fetchSandboxAvailability,
  fetchWebhookEndpointStatus,
  PlatformHandshakeError,
  registerWebhookWithPlatform,
  releaseWithPlatform,
  type WebhookEndpointStatus,
} from '@modules/integrations/service/handshake'
import { getInstalledDb, getVaultFor } from '@modules/integrations/service/registry'
import { deriveVerifyToken } from '@modules/integrations/service/verify-token'
import { Hono } from 'hono'

interface ManagedConfig {
  mode: 'managed'
  platformBaseUrl?: string
  environment?: 'production' | 'staging'
}

function readManagedConfig(row: { channel: string; config: Record<string, unknown> }): ManagedConfig | null {
  if (row.channel !== 'whatsapp' || row.config.mode !== 'managed') return null
  return {
    mode: 'managed',
    platformBaseUrl: (row.config.platformBaseUrl as string | undefined) ?? undefined,
    environment: (row.config.environment as 'production' | 'staging' | undefined) ?? 'production',
  }
}

interface PlatformCreds {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  betterAuthSecret: string
}

function readPlatformCreds(rowPlatformBaseUrl: string | undefined): PlatformCreds | null {
  const platformBaseUrl = rowPlatformBaseUrl ?? process.env.VITE_PLATFORM_URL ?? ''
  const tenantId = process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
  const tenantHmacSecret = process.env.PLATFORM_HMAC_SECRET ?? ''
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET ?? ''
  if (!platformBaseUrl || !tenantId || !tenantHmacSecret || !betterAuthSecret) {
    return null
  }
  return { platformBaseUrl, tenantId, tenantHmacSecret, betterAuthSecret }
}

function tenantWebhookUrl(instanceId: string): string {
  const base =
    process.env.WEBHOOK_BASE_URL ??
    process.env.PUBLIC_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    `http://localhost:${process.env.PORT ?? '3000'}`
  return `${base.replace(/\/$/, '')}/api/channels/webhook/whatsapp/${instanceId}`
}

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)

  // Sandbox pool availability (proxied from platform `GET /health`). Lets
  // the UI gate the "Claim sandbox" button when the pool is empty so the
  // user doesn't get a confusing 503 on click. Returns 0 when platform creds
  // are missing — same effect as no-pool: button disabled.
  .get('/managed/availability', async (c) => {
    const platformBaseUrl = process.env.VITE_PLATFORM_URL ?? ''
    const tenantId = process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
    const tenantHmacSecret = process.env.PLATFORM_HMAC_SECRET ?? ''
    if (!platformBaseUrl || !tenantId || !tenantHmacSecret) {
      return c.json({ sandboxPoolAvailable: 0, configured: false })
    }
    try {
      const data = await fetchSandboxAvailability({ platformBaseUrl, tenantId, tenantHmacSecret })
      return c.json({ sandboxPoolAvailable: data.sandboxPoolAvailable, configured: true })
    } catch (err) {
      if (err instanceof PlatformHandshakeError) {
        return c.json({ sandboxPoolAvailable: 0, configured: true, error: err.message }, 502)
      }
      throw err
    }
  })

  // Claim a sandbox channel. Idempotent on `(organizationId, environment)`:
  // re-clicking after a successful claim returns the existing instance row
  // without re-handshaking. If the vault still has the secret but the
  // channel-instances row was wiped (e.g. tenant `db:reset`), falls through
  // to re-handshake — the platform's `readExistingClaim` returns the same
  // secret pair, vault upsert is a no-op, and the row is recreated.
  .post('/managed/claim', async (c) => {
    const organizationId = c.get('organizationId')
    const environment: 'production' | 'staging' = process.env.NODE_ENV === 'production' ? 'production' : 'staging'

    const creds = readPlatformCreds(undefined)
    if (!creds) return c.json({ error: 'platform_not_configured' }, 503)
    const { platformBaseUrl, tenantId, tenantHmacSecret, betterAuthSecret } = creds

    // Stable per-(org, env) channel instance id so re-clicks (multi-tab,
    // post-`db:reset`, mid-flight crash) all converge to the same row.
    // Matches what the platform persists in `tester_links.channel_instance_id`.
    const channelInstanceId = `mgd-${organizationId}-${environment}`

    const vault = getVaultFor(organizationId)
    if (await vault.hasSecret('vobase-platform')) {
      const instances = await listInstances(organizationId, 'whatsapp')
      const existing = instances.find((i) => isManagedConfig(i.config))
      if (existing) {
        return c.json({ status: 'already_claimed', instance: existing })
      }
      // Vault has secret but no row — `db:reset` case. Fall through to
      // re-handshake; platform returns the same secret pair via
      // `readExistingClaim`, vault store overwrites in place, row gets recreated.
    }

    // Delegate the 4-step sequence (handshake → vault → upsert → webhook
    // register) to `claimAndBootstrap` so the orchestration lives in one
    // place and is unit-testable without HTTP. The handler stays thin:
    // bind handler-only context (db, webhook URL, verify-token derivation),
    // map `PlatformHandshakeError` to HTTP status, return the response.
    const webhookUrl = tenantWebhookUrl(channelInstanceId)
    const verifyToken = deriveVerifyToken({
      tenantSlug: tenantId,
      environment,
      provider: 'whatsapp',
      betterAuthSecret,
    })

    try {
      const result = await claimAndBootstrap({
        tenantSlug: tenantId,
        environment,
        channelInstanceId,
        platformBaseUrl,
        hmacSecret: tenantHmacSecret,
        kind: 'sandbox',
        vault,
        upsertInstance: (input) => upsertManagedInstance(getInstalledDb(), input),
        organizationId,
        webhookUrl,
        verifyToken,
      })
      const webhook = result.webhookOk
        ? ({ ok: true, registeredAt: result.webhookRegisteredAt ?? '' } as const)
        : ({ ok: false, detail: result.webhookDetail ?? 'unknown' } as const)
      return c.json({ status: 'claimed', instance: result.instance, webhook }, 201)
    } catch (err) {
      if (err instanceof PlatformHandshakeError && err.code === 'pool_exhausted') {
        return c.json({ error: 'pool_exhausted' }, 503)
      }
      if (err instanceof PlatformHandshakeError) {
        return c.json({ error: 'platform_error', detail: err.message, code: err.code ?? null }, 502)
      }
      throw err
    }
  })

  .delete('/managed/:instanceId', async (c) => {
    const instanceId = c.req.param('instanceId')
    const organizationId = c.get('organizationId')
    const row = await getInstance(instanceId)

    if (!row || row.organizationId !== organizationId) {
      return c.json({ error: 'not_found' }, 404)
    }
    const managed = readManagedConfig(row)
    if (!managed) return c.json({ error: 'not_managed' }, 400)

    const creds = readPlatformCreds(managed.platformBaseUrl)
    if (!creds) return c.json({ error: 'platform_not_configured' }, 500)

    try {
      await releaseWithPlatform({
        platformBaseUrl: creds.platformBaseUrl,
        tenantId: creds.tenantId,
        tenantHmacSecret: creds.tenantHmacSecret,
        environment: managed.environment ?? 'production',
      })
    } catch (err) {
      if (err instanceof PlatformHandshakeError) {
        return c.json({ error: 'platform_release_failed', detail: err.message }, 502)
      }
      throw err
    }

    await removeInstance(instanceId, organizationId)
    return c.json({ released: true })
  })

  // Read webhook registration status for THIS channel from the platform.
  .get('/managed/:instanceId/webhook', async (c) => {
    const instanceId = c.req.param('instanceId')
    const organizationId = c.get('organizationId')
    const row = await getInstance(instanceId)

    if (!row || row.organizationId !== organizationId) {
      return c.json({ error: 'not_found' }, 404)
    }
    const managed = readManagedConfig(row)
    if (!managed) return c.json({ error: 'not_managed' }, 400)

    const creds = readPlatformCreds(managed.platformBaseUrl)
    if (!creds) return c.json({ error: 'platform_not_configured' }, 500)

    let endpoints: WebhookEndpointStatus[]
    try {
      endpoints = await fetchWebhookEndpointStatus({
        platformBaseUrl: creds.platformBaseUrl,
        tenantId: creds.tenantId,
        tenantHmacSecret: creds.tenantHmacSecret,
        provider: 'whatsapp',
        channelInstanceId: instanceId,
      })
    } catch (err) {
      if (err instanceof PlatformHandshakeError) {
        return c.json({ error: 'platform_status_failed', detail: err.message }, 502)
      }
      throw err
    }

    return c.json({ endpoint: endpoints[0] ?? null })
  })

  // Re-trigger the platform challenge against the registered URL — useful
  // when the operator has just rotated the public URL or wants a fresh
  // verified-at timestamp without restarting the tenant server.
  .post('/managed/:instanceId/webhook/re-verify', async (c) => {
    const instanceId = c.req.param('instanceId')
    const organizationId = c.get('organizationId')
    const row = await getInstance(instanceId)

    if (!row || row.organizationId !== organizationId) {
      return c.json({ error: 'not_found' }, 404)
    }
    const managed = readManagedConfig(row)
    if (!managed) return c.json({ error: 'not_managed' }, 400)

    const creds = readPlatformCreds(managed.platformBaseUrl)
    if (!creds) return c.json({ error: 'platform_not_configured' }, 500)

    const environment = managed.environment ?? 'production'
    const webhookUrl = tenantWebhookUrl(instanceId)
    const verifyToken = deriveVerifyToken({
      tenantSlug: creds.tenantId,
      environment,
      provider: 'whatsapp',
      betterAuthSecret: creds.betterAuthSecret,
    })

    try {
      const res = await registerWebhookWithPlatform({
        platformBaseUrl: creds.platformBaseUrl,
        tenantId: creds.tenantId,
        tenantHmacSecret: creds.tenantHmacSecret,
        environment,
        provider: 'whatsapp',
        channelInstanceId: instanceId,
        webhookUrl,
        verifyToken,
      })
      return c.json({ ok: true, registeredAt: res.registeredAt, webhookUrl })
    } catch (err) {
      if (err instanceof PlatformHandshakeError) {
        return c.json(
          {
            error: 'verify_failed',
            detail: err.message,
            code: err.code,
            webhookUrl,
          },
          502,
        )
      }
      throw err
    }
  })

export default app

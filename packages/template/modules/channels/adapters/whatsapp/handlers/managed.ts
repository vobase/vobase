/**
 * Managed-mode WhatsApp control-plane endpoints (auth-gated, per-org).
 *
 * Routes:
 *   - DELETE /managed/:instanceId          — release the channel back to the platform pool
 *   - GET    /managed/:instanceId/webhook  — proxy this channel's webhook registration status
 *   - POST   /managed/:instanceId/webhook/re-verify
 *                                          — re-trigger the platform challenge
 *                                            against the registered URL (debugging aid)
 *
 * The webhook endpoints proxy signed requests to the platform's
 * `/api/provisioning/webhook-endpoints/*` so the frontend can render +
 * refresh registration status without holding the HMAC secret in the bundle.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { getInstance, removeInstance } from '@modules/channels/service/instances'
import {
  fetchWebhookEndpointStatus,
  PlatformHandshakeError,
  registerWebhookWithPlatform,
  releaseWithPlatform,
  type WebhookEndpointStatus,
} from '@modules/integrations/service/handshake'
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

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)

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
    const webhookBaseUrl =
      process.env.WEBHOOK_BASE_URL ??
      process.env.PUBLIC_BASE_URL ??
      process.env.BETTER_AUTH_URL ??
      `http://localhost:${process.env.PORT ?? '3001'}`
    const webhookUrl = `${webhookBaseUrl.replace(/\/$/, '')}/api/channels/webhook/whatsapp/${instanceId}`
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

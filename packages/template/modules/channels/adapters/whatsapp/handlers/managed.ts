/**
 * Managed-mode WhatsApp control-plane endpoints (auth-gated, per-org).
 *
 * Routes:
 *   - GET    /managed/availability                  — sandbox pool availability count
 *   - POST   /managed/claim                         — claim a sandbox channel from the platform pool
 *   - DELETE /managed/:instanceId                   — release the channel back to the platform pool
 *   - GET    /managed/:instanceId/webhook           — proxy this channel's webhook registration status
 *   - POST   /managed/:instanceId/webhook/re-verify — re-trigger the platform challenge
 *                                                     against the registered URL (debugging aid)
 *   - GET    /managed/notification/availability     — notification pool availability count
 *   - POST   /managed/notification/claim            — claim a notification-tier channel from the pool
 *   - DELETE /managed/notification/:instanceId      — release the notification channel back to the pool
 *
 * The webhook endpoints proxy signed requests to the platform's
 * `/api/provisioning/webhook-endpoints/*` so the frontend can render +
 * refresh registration status without holding the HMAC secret in the bundle.
 *
 * `claim` replaces the legacy boot-time auto-provision: a tenant operator
 * clicks "Claim sandbox" / "Claim notification channel" in the UI and the
 * same handshake + vault store + channel-instances upsert + webhook
 * self-register sequence runs synchronously inside the request.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { agentDefinitions } from '@modules/agents/schema'
import { isManagedConfig, isManagedNotifConfig } from '@modules/channels/adapters/whatsapp/factory'
import { claimAndBootstrap } from '@modules/channels/managed/bootstrap'
import { findKind, type ManagedChannelKind } from '@modules/channels/managed/registry'
import { getInstance, listInstances, removeInstance, upsertManagedInstance } from '@modules/channels/service/instances'
import {
  fetchNotificationAvailability,
  fetchSandboxAvailability,
  fetchWebhookEndpointStatus,
  PlatformHandshakeError,
  registerWebhookWithPlatform,
  release as releasePlatformClaim,
  releaseWithPlatform,
  type WebhookEndpointStatus,
} from '@modules/integrations/service/handshake'
import { getInstalledDb, getVaultFor } from '@modules/integrations/service/registry'
import { deriveVerifyToken } from '@modules/integrations/service/verify-token'
import { and, asc, eq } from 'drizzle-orm'
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
  tenantSlug: string
  tenantHmacSecret: string
  betterAuthSecret: string
}

function readPlatformCreds(rowPlatformBaseUrl: string | undefined): PlatformCreds | null {
  const platformBaseUrl = rowPlatformBaseUrl ?? process.env.VITE_PLATFORM_URL ?? ''
  // X-Tenant-Id must be the platform-issued nanoid (tenants.id), not the
  // human slug. The provisioning job stamps PLATFORM_TENANT_ID alongside
  // PLATFORM_TENANT_SLUG; we read the id here so platform HMAC verification
  // resolves the tenant row instead of silently dropping to the anonymous
  // {ok:true} branch.
  const tenantId = process.env.PLATFORM_TENANT_ID ?? ''
  // tenantSlug is the human slug — required as the `info` salt for the
  // webhook verify-token HKDF. Both ends of the hub-challenge derivation
  // (registration here, GET handler in adapter factory) MUST agree on this
  // value, so we read it from `VITE_PLATFORM_TENANT_SLUG` (the same env the
  // factory reads) rather than substituting the nanoid.
  const tenantSlug = process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
  const tenantHmacSecret = process.env.PLATFORM_HMAC_SECRET ?? ''
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET ?? ''
  if (!platformBaseUrl || !tenantId || !tenantSlug || !tenantHmacSecret || !betterAuthSecret) {
    return null
  }
  return { platformBaseUrl, tenantId, tenantSlug, tenantHmacSecret, betterAuthSecret }
}

function tenantWebhookUrl(instanceId: string): string {
  const base =
    process.env.WEBHOOK_BASE_URL ??
    process.env.PUBLIC_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    `http://localhost:${process.env.PORT ?? '3000'}`
  return `${base.replace(/\/$/, '')}/api/channels/webhook/whatsapp/${instanceId}`
}

/**
 * Map a `PlatformHandshakeError` thrown from `claimAndBootstrap` to the
 * tenant's external HTTP response. Returns `null` when `err` isn't a
 * handshake error so the caller can rethrow.
 *
 * `pool_exhausted` → 503 (transient, retry once supply recovers); platform
 * 4xx → 409 with the structured `code` (`channel_instance_owned_by_other_tenant`,
 * residual `allocation_cap_exceeded` — tenant-actionable, not a bad gateway);
 * everything else → 502.
 */
function mapPlatformError(c: { json: (body: unknown, status: number) => Response }, err: unknown): Response | null {
  if (!(err instanceof PlatformHandshakeError)) return null
  if (err.code === 'pool_exhausted') return c.json({ error: 'pool_exhausted' }, 503)
  if (err.status !== null && err.status >= 400 && err.status < 500) {
    return c.json({ error: 'platform_conflict', detail: err.message, code: err.code ?? null }, 409)
  }
  return c.json({ error: 'platform_error', detail: err.message, code: err.code ?? null }, 502)
}

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)

  // Sandbox pool availability (proxied from platform `GET /health`). Lets
  // the UI gate the "Claim sandbox" button when the pool is empty so the
  // user doesn't get a confusing 503 on click. Returns 0 when platform creds
  // are missing — same effect as no-pool: button disabled.
  .get('/managed/availability', async (c) => {
    const platformBaseUrl = process.env.VITE_PLATFORM_URL ?? ''
    const tenantId = process.env.PLATFORM_TENANT_ID ?? ''
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
    // The Dockerfile pins `NODE_ENV=production` for every tenant container
    // (both production and staging Railway envs), so NODE_ENV can't
    // distinguish them. The provisioning job stamps `STAGING=true` only on
    // staging Railway envs (see platform CONTRACTS.md §"Env var value
    // contracts"); production envs have it unset. Read that instead so the
    // claim's `(tenant, env, channelInstanceId)` key — and the resulting
    // platform-pool slot — actually correspond to the deploy environment
    // the user is sitting in.
    const environment: 'production' | 'staging' = process.env.STAGING === 'true' ? 'staging' : 'production'

    const creds = readPlatformCreds(undefined)
    if (!creds) return c.json({ error: 'platform_not_configured' }, 503)
    const { platformBaseUrl, tenantId, tenantSlug, tenantHmacSecret, betterAuthSecret } = creds

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
      tenantSlug,
      environment,
      provider: 'whatsapp',
      betterAuthSecret,
    })

    // Pick the org's first enabled AI agent as the channel's default
    // assignee — so new inbound conversations route to it without operator
    // setup. Null when the org has no agents yet; webhook handler tolerates
    // null (skips auto-assignment).
    const [firstAgent] = await getInstalledDb()
      .select({ id: agentDefinitions.id })
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.organizationId, organizationId), eq(agentDefinitions.enabled, true)))
      .orderBy(asc(agentDefinitions.createdAt))
      .limit(1)

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
        // Canonical principal token `agent:<id>` — matches the format
        // every other writer uses (seed data, web instance create form),
        // every reader expects (`<Principal id=…>`, mention rendering,
        // hover cards), and the `conversations.assignee` column receives
        // verbatim via `initialAssignee` in `dispatchInbound`.
        defaultAssignee: firstAgent ? `agent:${firstAgent.id}` : null,
      })
      const webhook = result.webhookOk
        ? ({ ok: true, registeredAt: result.webhookRegisteredAt ?? '' } as const)
        : ({ ok: false, detail: result.webhookDetail ?? 'unknown' } as const)
      return c.json({ status: 'claimed', instance: result.instance, webhook }, 201)
    } catch (err) {
      const mapped = mapPlatformError(c, err)
      if (mapped) return mapped
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

  // ─── Notification tier (staff-facing managed WhatsApp) ─────────────────
  // Parallel to the sandbox routes above; threads `kind: 'notification'`
  // through the registry so paths/vault/discriminators all switch together.

  .get('/managed/notification/availability', async (c) => {
    const platformBaseUrl = process.env.VITE_PLATFORM_URL ?? ''
    const tenantId = process.env.PLATFORM_TENANT_ID ?? ''
    const tenantHmacSecret = process.env.PLATFORM_HMAC_SECRET ?? ''
    if (!platformBaseUrl || !tenantId || !tenantHmacSecret) {
      return c.json({ notificationPoolAvailable: 0, configured: false })
    }
    try {
      const data = await fetchNotificationAvailability({ platformBaseUrl, tenantId, tenantHmacSecret })
      return c.json({ notificationPoolAvailable: data.notificationPoolAvailable, configured: true })
    } catch (err) {
      if (err instanceof PlatformHandshakeError) {
        return c.json({ notificationPoolAvailable: 0, configured: true, error: err.message }, 502)
      }
      throw err
    }
  })

  .post('/managed/notification/claim', async (c) => {
    const organizationId = c.get('organizationId')
    const environment: 'production' | 'staging' = process.env.STAGING === 'true' ? 'staging' : 'production'

    const creds = readPlatformCreds(undefined)
    if (!creds) return c.json({ error: 'platform_not_configured' }, 503)
    const { platformBaseUrl, tenantId, tenantSlug, tenantHmacSecret, betterAuthSecret } = creds

    const kindSpec = findKind('notification' satisfies ManagedChannelKind)
    // `-notif` suffix keeps the row id distinct from the sandbox row so a
    // tenant can hold both kinds simultaneously and the id is
    // self-describing in logs. The channel_instances unique index keys on
    // `(orgId, channel, platformChannelId)`, so `channel` already
    // separates them at the DB level.
    const channelInstanceId = `mgd-${organizationId}-${environment}-notif`

    // Vault-first idempotency: short-circuit when the vault + row pair
    // already exists. Post-`db:reset` (vault survived, row wiped) falls
    // through so platform `readExistingClaim` returns the same secret pair
    // and the row gets recreated.
    const vault = getVaultFor(organizationId)
    if (await vault.hasSecret(kindSpec.vaultProvider)) {
      const instances = await listInstances(organizationId, kindSpec.channelName)
      const existing = instances.find((i) => isManagedNotifConfig(i.config))
      if (existing) {
        return c.json({ status: 'already_claimed', instance: existing })
      }
    }

    const webhookUrl = tenantWebhookUrl(channelInstanceId)
    const verifyToken = deriveVerifyToken({
      tenantSlug,
      environment,
      provider: kindSpec.channelName,
      betterAuthSecret,
    })

    try {
      const result = await claimAndBootstrap({
        tenantSlug: tenantId,
        environment,
        channelInstanceId,
        platformBaseUrl,
        hmacSecret: tenantHmacSecret,
        kind: 'notification',
        vault,
        upsertInstance: (input) => upsertManagedInstance(getInstalledDb(), input),
        organizationId,
        webhookUrl,
        verifyToken,
        // Staff WA replies route via `dispatchStaffReply` (reads
        // `defaultOperatorAgentId` from `org_settings`), not via this row's
        // `config.defaultAssignee`. Null avoids storing a misleading pointer.
        defaultAssignee: null,
      })
      const webhook = result.webhookOk
        ? ({ ok: true, registeredAt: result.webhookRegisteredAt ?? '' } as const)
        : ({ ok: false, detail: result.webhookDetail ?? 'unknown' } as const)
      return c.json({ status: 'claimed', instance: result.instance, webhook }, 201)
    } catch (err) {
      const mapped = mapPlatformError(c, err)
      if (mapped) return mapped
      throw err
    }
  })

  .delete('/managed/notification/:instanceId', async (c) => {
    const instanceId = c.req.param('instanceId')
    const organizationId = c.get('organizationId')
    const row = await getInstance(instanceId)
    if (!row || row.organizationId !== organizationId) {
      return c.json({ error: 'not_found' }, 404)
    }
    const kindSpec = findKind('notification' satisfies ManagedChannelKind)
    if (row.channel !== kindSpec.channelName || !isManagedNotifConfig(row.config)) {
      return c.json({ error: 'not_managed_notif' }, 400)
    }
    const rowPlatformBaseUrl = (row.config.platformBaseUrl as string | undefined) ?? undefined
    const environment = (row.config.environment as 'production' | 'staging' | undefined) ?? 'production'
    const creds = readPlatformCreds(rowPlatformBaseUrl)
    if (!creds) return c.json({ error: 'platform_not_configured' }, 500)

    try {
      await releasePlatformClaim('notification', {
        platformBaseUrl: creds.platformBaseUrl,
        tenantId: creds.tenantId,
        tenantHmacSecret: creds.tenantHmacSecret,
        environment,
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
      tenantSlug: creds.tenantSlug,
      environment,
      provider: 'whatsapp',
      betterAuthSecret: creds.betterAuthSecret,
    })

    try {
      const res = await registerWebhookWithPlatform({
        platformBaseUrl: creds.platformBaseUrl,
        tenantId: creds.tenantId,
        tenantHmacSecret: creds.tenantHmacSecret,
        provider: 'whatsapp',
        webhookUrl,
        verifyToken,
      })
      // Persist (or refresh) the platform-minted endpointId into config so
      // the QR encoding stays stable across re-verifies. `upsertManagedInstance`
      // shallow-merges `config` on conflict so the rest of the row survives.
      const platformChannelId = typeof row.config.platformChannelId === 'string' ? row.config.platformChannelId : null
      if (platformChannelId) {
        await upsertManagedInstance(getInstalledDb(), {
          id: instanceId,
          organizationId,
          channel: row.channel,
          platformChannelId,
          displayName: row.displayName ?? '',
          role: row.role,
          mode: row.config.mode === 'managed-notif' ? 'managed-notif' : 'managed',
          config: { ...row.config, endpointId: res.endpointId },
        })
      }
      return c.json({ ok: true, registeredAt: res.registeredAt, webhookUrl, endpointId: res.endpointId })
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

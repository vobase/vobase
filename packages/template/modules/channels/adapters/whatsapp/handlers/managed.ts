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
import { isManagedConfig } from '@modules/channels/adapters/whatsapp/factory'
import { claimAndBootstrap } from '@modules/channels/managed/bootstrap'
import { findKind, type ManagedChannelKind } from '@modules/channels/managed/registry'
import {
  getInstance,
  hardRemoveInstance,
  listInstances,
  removeInstance,
  upsertManagedInstance,
} from '@modules/channels/service/instances'
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
import { syncStaffLinksEnqueue } from '@modules/team/service/staff-link-sync'
import { logger } from '@vobase/core'
import { and, asc, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'

import { readAppBaseUrl } from '~/runtime/app-url'

// Full assignee token (`agent:<id>` or `user:<id>`) — matches the format the
// inbox `AssigneeBadge` emits and the format `config.defaultAssignee` stores
// elsewhere. Bare ids are rejected to keep one canonical shape on the wire.
const claimBodySchema = z.object({
  defaultAssignee: z
    .string()
    .regex(/^(agent|user):[A-Za-z0-9_-]+$/)
    .optional(),
})

/**
 * Tolerant parse of the optional `POST /managed/(notification/)?claim` body.
 * Returns the assignee token the dialog selected, or `null` when the body is
 * absent / malformed / empty — letting the caller fall through to the legacy
 * "auto-pick first enabled agent" behaviour.
 */
async function parseOptionalAgentBody(c: Context): Promise<string | null> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return null
  }
  const parsed = claimBodySchema.safeParse(raw)
  if (!parsed.success || !parsed.data.defaultAssignee) return null
  return parsed.data.defaultAssignee
}

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

function tenantWebhookUrl(channelName: string, instanceId: string): string {
  const base = readAppBaseUrl()
  // Path segment must match the row's `channel` column — the generic webhook
  // router (`modules/channels/handlers/webhook.ts`) returns 404 on mismatch.
  return `${base.replace(/\/$/, '')}/api/channels/webhook/${channelName}/${instanceId}`
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
  //
  // Optional body `{ defaultAssignee?: string }`: agent UUID (no `agent:`
  // prefix — server adds it). Falls back to the org's first enabled agent
  // when omitted, preserving the original UI's "auto-pick" behaviour for
  // callers that don't send a body.
  .post('/managed/claim', async (c) => {
    const organizationId = c.get('organizationId')

    const bodyAssignee = await parseOptionalAgentBody(c)
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
    const webhookUrl = tenantWebhookUrl('whatsapp', channelInstanceId)
    const verifyToken = deriveVerifyToken({
      tenantSlug,
      environment,
      provider: 'whatsapp',
      betterAuthSecret,
    })

    // Resolve the default assignee: explicit body wins, else fall back to the
    // org's first enabled AI agent (formatted as `agent:<id>`) so re-clicks
    // from auto-tooling still route. Null when the org has no agents yet;
    // webhook handler tolerates null (skips auto-assignment).
    let assigneeToken: string | null = bodyAssignee
    if (assigneeToken === null) {
      const [firstAgent] = await getInstalledDb()
        .select({ id: agentDefinitions.id })
        .from(agentDefinitions)
        .where(and(eq(agentDefinitions.organizationId, organizationId), eq(agentDefinitions.enabled, true)))
        .orderBy(asc(agentDefinitions.createdAt))
        .limit(1)
      assigneeToken = firstAgent ? `agent:${firstAgent.id}` : null
    }

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
        defaultAssignee: assigneeToken,
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

  // ─── Notification tier (staff-facing managed WhatsApp) ─────────────────
  // Parallel to the sandbox routes above; threads `kind: 'notification'`
  // through the registry so paths/vault/discriminators all switch together.

  // Notification pool availability — symmetric to `/managed/availability`.
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

  // Claim a notification-tier channel. Same `claimAndBootstrap` orchestration
  // as the sandbox claim — only `kind: 'notification'` differs, which the
  // registry resolves to the `whatsapp_notif` channel name + the
  // `vobase-platform-notification` vault provider. Magic-link auth needs no
  // platform-side registration: the tenant signs each `magic-finish` URL with
  // the shared HMAC secret and the platform's `/api/redirect` endpoint
  // verifies it. Idempotent: re-claiming returns the existing row.
  .post('/managed/notification/claim', async (c) => {
    const organizationId = c.get('organizationId')
    const environment: 'production' | 'staging' = process.env.STAGING === 'true' ? 'staging' : 'production'

    const bodyAssignee = await parseOptionalAgentBody(c)

    const creds = readPlatformCreds(undefined)
    if (!creds) return c.json({ error: 'platform_not_configured' }, 503)
    const { platformBaseUrl, tenantId, tenantSlug, tenantHmacSecret, betterAuthSecret } = creds

    const kindSpec = findKind('notification' satisfies ManagedChannelKind)
    // `-notif` suffix keeps the row id distinct from the sandbox row so a
    // tenant can hold both kinds simultaneously and the id is
    // self-describing in logs.
    const channelInstanceId = `mgd-${organizationId}-${environment}-notif`

    // Push existing staff WhatsApp phones to the platform as staff-links.
    // Without this, `syncStaffLinks` only runs on a staff-phone edit or the
    // daily cron — so staff who verified their number BEFORE the channel was
    // claimed have no platform staff-link, and their inbound WhatsApp replies
    // are silently dropped by the platform forwarder (`forwardToLinkedStaff`).
    const enqueueStaffLinkSync = async (): Promise<void> => {
      try {
        await syncStaffLinksEnqueue(organizationId)
      } catch (err) {
        logger.warn(
          { err, organizationId },
          '[channels/managed] staff-link sync enqueue failed — notification claim still succeeded',
        )
      }
    }

    // Vault-first idempotency: short-circuit when the vault + row pair
    // already exists. Post-`db:reset` (vault survived, row wiped) falls
    // through so platform `readExistingClaim` returns the same secret pair
    // and the row gets recreated.
    const vault = getVaultFor(organizationId)
    if (await vault.hasSecret(kindSpec.vaultProvider)) {
      const instances = await listInstances(organizationId, kindSpec.channelName)
      const existing = instances.find((i) => isManagedConfig(i.config))
      if (existing) {
        await enqueueStaffLinkSync()
        return c.json({ status: 'already_claimed', instance: existing })
      }
    }

    // The notification kind's inbound (forwarded staff replies) is dispatched
    // by the registry-driven router at `/api/channels/managed/inbound/:id`
    // (`inboundDispatch: 'staff_reply'` → `dispatchStaffReply`), NOT the
    // generic customer-webhook router — so it self-registers that path.
    const webhookUrl = `${readAppBaseUrl().replace(/\/$/, '')}/api/channels/managed/inbound/${channelInstanceId}`
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
        // Stored for display in the channels table so operators see who's
        // nominally owning the row. Staff WA replies route via
        // `dispatchStaffReply` (`defaultOperatorAgentId` from `org_settings`),
        // so this value is informational, not behavioural.
        defaultAssignee: bodyAssignee,
      })
      await enqueueStaffLinkSync()
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

  // Release the notification channel back to the platform pool. Hard-deletes
  // the row: notification rows are staff-facing and have no inbound FK from
  // `messaging.conversations`, so they can be dropped outright. Soft-delete
  // would leave the deterministic `id` (`mgd-<org>-<env>-notif`) occupied,
  // which PK-collides on the next claim when the platform allocator hands out
  // a different pool row.
  .delete('/managed/notification/:instanceId', async (c) => {
    const instanceId = c.req.param('instanceId')
    const organizationId = c.get('organizationId')
    const row = await getInstance(instanceId)
    if (!row || row.organizationId !== organizationId) {
      return c.json({ error: 'not_found' }, 404)
    }
    const kindSpec = findKind('notification' satisfies ManagedChannelKind)
    if (row.channel !== kindSpec.channelName || !isManagedConfig(row.config)) {
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

    await hardRemoveInstance(instanceId, organizationId)
    return c.json({ released: true })
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
    // Use the row's `channel` value for both the URL path segment and the
    // verify-token derivation — the webhook router is keyed on
    // `instance.channel`, not a hardcoded literal.
    const provider = row.channel
    const webhookUrl = tenantWebhookUrl(provider, instanceId)
    const verifyToken = deriveVerifyToken({
      tenantSlug: creds.tenantSlug,
      environment,
      provider,
      betterAuthSecret: creds.betterAuthSecret,
    })

    try {
      const res = await registerWebhookWithPlatform({
        platformBaseUrl: creds.platformBaseUrl,
        tenantId: creds.tenantId,
        tenantHmacSecret: creds.tenantHmacSecret,
        provider,
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

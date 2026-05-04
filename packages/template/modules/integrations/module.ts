/**
 * `integrations` module — owns the tenant-side secret vault for
 * platform-managed integrations (currently `vobase-platform` for managed
 * WhatsApp). Registered AFTER `channels` in `runtime/modules.ts` so the
 * `requires` topo-sort guarantees the channels service is installed before
 * the auto-provisioner can call `upsertManagedInstance`.
 *
 * On boot, when `META_PLATFORM_AUTO_PROVISION=true` and the org has not yet
 * received a managed channel for the current `environment`, the init hook
 * runs the handshake + persists the secret pair + materializes the
 * channel_instance row. Pool-exhaustion is non-fatal.
 */

import { authOrganization, logger } from '@vobase/core'

import type { ModuleDef } from '~/runtime'
import { autoProvisionManagedWhatsApp } from './service/auto-provision'
import { PlatformHandshakeError, registerWebhookWithPlatform } from './service/handshake'
import { installVaultRegistry } from './service/registry'
import { deriveVerifyToken } from './service/verify-token'
import * as web from './web'

function readEnv(name: string): string | undefined {
  const v = process.env[name]
  return v && v.length > 0 ? v : undefined
}

const integrations: ModuleDef = {
  name: 'integrations',
  requires: ['channels'],
  web: { routes: web.routes },
  jobs: [],
  async init(ctx) {
    installVaultRegistry({ db: ctx.db })

    if (process.env.META_PLATFORM_AUTO_PROVISION !== 'true') {
      return
    }

    // Resolve organization: explicit env override wins; otherwise fall back to
    // the first org in the auth.organization table. Single-org tenants (the
    // default mode) have exactly one row, so the fallback is unambiguous.
    // Multi-org tenants should set PLATFORM_DEFAULT_ORGANIZATION_ID explicitly
    // to avoid creating the channel under whichever org happens to sort first.
    const envOrg = readEnv('PLATFORM_DEFAULT_ORGANIZATION_ID')
    let organizationId: string
    if (envOrg) {
      organizationId = envOrg
    } else {
      const [firstOrg] = await ctx.db.select({ id: authOrganization.id }).from(authOrganization).limit(1)
      if (!firstOrg) {
        logger.warn(
          {},
          '[integrations] META_PLATFORM_AUTO_PROVISION=true but no organizations exist yet — skipping auto-provision',
        )
        return
      }
      organizationId = firstOrg.id
    }

    // Stable per-(org, env) channel instance id so re-boots are idempotent
    // (combined with `upsertManagedInstance`'s lookup on platformChannelId).
    const environment: 'production' | 'staging' = process.env.NODE_ENV === 'production' ? 'production' : 'staging'
    const channelInstanceId = `mgd-${organizationId}-${environment}`

    const result = await autoProvisionManagedWhatsApp({
      db: ctx.db,
      organizationId,
      environment,
      channelInstanceId,
    })

    if (result.status === 'error') {
      logger.error({ reason: result.reason }, '[integrations] auto-provision failed')
      return
    }
    if (result.status === 'pool_exhausted') {
      logger.warn({}, '[integrations] platform pool exhausted — tenant booted without managed channel')
      return
    }
    if (result.status === 'skipped') {
      return
    }

    // Self-register webhook URL with the platform now that the channel exists.
    // The platform runs a Meta-style hub challenge against the URL using the
    // verify token we derive here (and the WhatsApp adapter re-derives the
    // same token from BETTER_AUTH_SECRET for its GET handler). Best-effort:
    // failure logs a warning but doesn't crash boot — the forwarder still
    // falls back to tenant_environments.instance_url / Railway domain.
    await registerManagedWebhook({ organizationId, environment, channelInstanceId })
  },
}

async function registerManagedWebhook(input: {
  organizationId: string
  environment: 'production' | 'staging'
  channelInstanceId: string
}): Promise<void> {
  const platformBaseUrl = readEnv('VITE_PLATFORM_URL')
  const tenantId = readEnv('VITE_PLATFORM_TENANT_SLUG')
  const tenantHmacSecret = readEnv('PLATFORM_HMAC_SECRET')
  const betterAuthSecret = readEnv('BETTER_AUTH_SECRET')

  if (!platformBaseUrl || !tenantId || !tenantHmacSecret || !betterAuthSecret) {
    logger.warn({}, '[integrations] webhook self-registration skipped — required env vars missing')
    return
  }

  const webhookBaseUrl = resolvePublicBaseUrl()
  if (!webhookBaseUrl) {
    logger.warn(
      {},
      '[integrations] webhook self-registration skipped — no public base URL (set WEBHOOK_BASE_URL or BETTER_AUTH_URL)',
    )
    return
  }
  const webhookUrl = `${webhookBaseUrl.replace(/\/$/, '')}/api/channels/webhook/whatsapp/${input.channelInstanceId}`

  const verifyToken = deriveVerifyToken({
    tenantSlug: tenantId,
    environment: input.environment,
    provider: 'whatsapp',
    betterAuthSecret,
  })

  try {
    const res = await registerWebhookWithPlatform({
      platformBaseUrl,
      tenantId,
      tenantHmacSecret,
      environment: input.environment,
      provider: 'whatsapp',
      channelInstanceId: input.channelInstanceId,
      webhookUrl,
      verifyToken,
    })
    logger.info({ webhookUrl, registeredAt: res.registeredAt }, '[integrations] webhook self-registration succeeded')
  } catch (err) {
    if (err instanceof PlatformHandshakeError) {
      logger.warn(
        { status: err.status, code: err.code, webhookUrl },
        '[integrations] webhook self-registration failed (non-fatal)',
      )
    } else {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err), webhookUrl },
        '[integrations] webhook self-registration failed (non-fatal)',
      )
    }
  }
}

/**
 * Cascade for the tenant's publicly-reachable origin. Mirrors the v1 template
 * convention so existing operators don't need a new env var: WEBHOOK_BASE_URL
 * (explicit tunnel override) → PUBLIC_BASE_URL (already used by bootstrap) →
 * BETTER_AUTH_URL (already required for auth) → localhost dev fallback.
 */
function resolvePublicBaseUrl(): string | null {
  return (
    readEnv('WEBHOOK_BASE_URL') ??
    readEnv('PUBLIC_BASE_URL') ??
    readEnv('BETTER_AUTH_URL') ??
    `http://localhost:${process.env.PORT ?? '3001'}`
  )
}

export default integrations

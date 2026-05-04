/**
 * Auto-provision managed WhatsApp channel on tenant boot.
 *
 * Gated on `META_PLATFORM_AUTO_PROVISION=true`. When the tenant has a
 * `vobase-platform` HMAC secret + `PLATFORM_TENANT_ID` env vars set and no
 * managed instance for the current `(environment)` exists yet, hit the
 * platform handshake and persist the result.
 *
 * Idempotent — `upsertManagedInstance` no-ops if the instance row already
 * exists for `(organization, channel='whatsapp', platformChannelId)`.
 */

import { upsertManagedInstance } from '@modules/channels/service/instances'
import { logger } from '@vobase/core'

import type { ScopedDb } from '~/runtime'
import { type HandshakeAllocation, handshakeWithPlatform, PlatformHandshakeError } from './handshake'
import { getInstalledDb, getVaultFor } from './registry'

interface AutoProvisionInput {
  /** Defaults to the registry-installed db handle when omitted. */
  db?: ScopedDb
  organizationId: string
  environment: 'production' | 'staging'
  channelInstanceId: string
}

export interface AutoProvisionResult {
  status: 'provisioned' | 'skipped' | 'already_provisioned' | 'pool_exhausted' | 'error'
  reason?: string
  instanceId?: string
}

function readEnv(name: string): string | undefined {
  const v = process.env[name]
  return v && v.length > 0 ? v : undefined
}

export async function autoProvisionManagedWhatsApp(input: AutoProvisionInput): Promise<AutoProvisionResult> {
  if (process.env.META_PLATFORM_AUTO_PROVISION !== 'true') {
    return { status: 'skipped', reason: 'META_PLATFORM_AUTO_PROVISION not enabled' }
  }

  const platformBaseUrl = readEnv('PLATFORM_URL')
  const tenantId = readEnv('PLATFORM_TENANT_ID')
  const tenantHmacSecret = readEnv('PLATFORM_HMAC_SECRET')

  if (!platformBaseUrl || !tenantId || !tenantHmacSecret) {
    return {
      status: 'skipped',
      reason: 'PLATFORM_URL / PLATFORM_TENANT_ID / PLATFORM_HMAC_SECRET not configured',
    }
  }

  // Existence-only check — boot path doesn't need the decrypted material,
  // and `readSecret` would burn 2 AES-GCM decrypts to throw the result away.
  const vault = getVaultFor(input.organizationId)
  if (await vault.hasSecret('vobase-platform')) {
    return { status: 'already_provisioned' }
  }

  let allocation: HandshakeAllocation
  try {
    allocation = await handshakeWithPlatform({
      platformBaseUrl,
      tenantId,
      tenantHmacSecret,
      environment: input.environment,
      channelInstanceId: input.channelInstanceId,
    })
  } catch (err) {
    if (err instanceof PlatformHandshakeError && err.code === 'pool_exhausted') {
      logger.warn(
        { organizationId: input.organizationId, environment: input.environment },
        '[integrations/auto-provision] platform pool exhausted',
      )
      return { status: 'pool_exhausted' }
    }
    logger.error(
      {
        organizationId: input.organizationId,
        environment: input.environment,
        error: err instanceof Error ? err.message : String(err),
      },
      '[integrations/auto-provision] handshake failed',
    )
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'handshake failed',
    }
  }

  await vault.storeSecret('vobase-platform', {
    routineSecret: allocation.routineSecret,
    rotationKey: allocation.rotationKey,
    keyVersion: allocation.keyVersion,
  })

  const db = input.db ?? getInstalledDb()
  const upserted = await upsertManagedInstance(db, {
    organizationId: input.organizationId,
    channel: 'whatsapp',
    platformChannelId: allocation.platformChannelId,
    displayName: `Platform sandbox (${input.environment})`,
    config: {
      mode: 'managed',
      platformChannelId: allocation.platformChannelId,
      platformBaseUrl,
      displayPhoneNumber: allocation.displayPhoneNumber,
      phoneNumberId: allocation.phoneNumberId,
      wabaId: allocation.wabaId,
      environment: input.environment,
    },
  })

  return { status: 'provisioned', instanceId: upserted.instance.id }
}

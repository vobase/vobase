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

import { logger } from '@vobase/core'

import type { ModuleDef } from '~/runtime'
import { autoProvisionManagedWhatsApp } from './service/auto-provision'
import { installVaultRegistry } from './service/registry'
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

    const organizationId = readEnv('PLATFORM_DEFAULT_ORGANIZATION_ID')
    if (!organizationId) {
      logger.warn(
        {},
        '[integrations] META_PLATFORM_AUTO_PROVISION=true but PLATFORM_DEFAULT_ORGANIZATION_ID is not set — skipping auto-provision',
      )
      return
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
    } else if (result.status === 'pool_exhausted') {
      logger.warn({}, '[integrations] platform pool exhausted — tenant booted without managed channel')
    }
  },
}

export default integrations

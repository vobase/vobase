/**
 * channels umbrella module — owns the `channel_instances` schema, the channel
 * adapter registry, the cross-channel admin page, and the generic dispatch
 * handlers. Each individual channel implementation lives at
 * `adapters/<name>/` and is registered via `service/registry.ts` during init.
 */

import type { ModuleDef } from '~/runtime'
import { createWebAdapter, WEB_CAPABILITIES, WEB_CHANNEL_NAME } from './adapters/web/adapter'
import { createWebInstancesService, installWebInstancesService } from './adapters/web/service/instances'
import {
  createWhatsAppAdapterFromConfig,
  WHATSAPP_CAPABILITIES,
  WHATSAPP_CHANNEL_NAME,
  WHATSAPP_NOTIF_CAPABILITIES,
  WHATSAPP_NOTIF_CHANNEL_NAME,
} from './adapters/whatsapp/factory'
import { runWhatsappSetupJob, WHATSAPP_SETUP_JOB, type WhatsappSetupJobData } from './adapters/whatsapp/jobs/setup'
import { channelsAgent } from './agent'
import handlers from './handlers'
import { createChannelInstancesService, installChannelInstancesService } from './service/instances'
import { createOutboundService, installOutboundService } from './service/outbound'
import { register as registerAdapter } from './service/registry'
import { createSignupNoncesService, installSignupNoncesService } from './service/signup-nonces'
import { createChannelsState, installChannelsState, type JobQueue } from './service/state'

const channels: ModuleDef = {
  name: 'channels',
  requires: ['messaging', 'contacts', 'drive'],
  web: { routes: { basePath: '/api/channels', handler: handlers } },
  agent: channelsAgent,
  jobs: [
    {
      name: WHATSAPP_SETUP_JOB,
      handler: (data: unknown) => runWhatsappSetupJob(data as WhatsappSetupJobData),
    },
  ],
  init(ctx) {
    installChannelsState(
      createChannelsState({
        jobs: ctx.jobs as unknown as JobQueue,
        realtime: ctx.realtime,
        auth: ctx.auth,
        db: ctx.db,
        rateLimits: ctx.rateLimits,
      }),
    )
    installChannelInstancesService(createChannelInstancesService({ db: ctx.db }))
    installWebInstancesService(createWebInstancesService({ db: ctx.db }))
    installSignupNoncesService(createSignupNoncesService({ db: ctx.db }))
    installOutboundService(createOutboundService())

    registerAdapter(WEB_CHANNEL_NAME, createWebAdapter, WEB_CAPABILITIES)
    registerAdapter(WHATSAPP_CHANNEL_NAME, createWhatsAppAdapterFromConfig, WHATSAPP_CAPABILITIES)
    // Notification-tier WA channel reuses the same factory — the factory's
    // `isManagedNotifConfig` branch routes the dispatch through the
    // `'vobase-platform-notification'` vault namespace. Registering under a
    // distinct channel name lets `findManagedChannel(orgId, 'notification')`
    // resolve the row independently of the customer-WA channel.
    registerAdapter(WHATSAPP_NOTIF_CHANNEL_NAME, createWhatsAppAdapterFromConfig, WHATSAPP_NOTIF_CAPABILITIES)
  },
}

export default channels

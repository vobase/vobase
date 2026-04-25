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
} from './adapters/whatsapp/factory'
import handlers from './handlers'
import { createChannelInstancesService, installChannelInstancesService } from './service/instances'
import { register as registerAdapter } from './service/registry'
import { createChannelsState, installChannelsState, type JobQueue } from './service/state'

const channels: ModuleDef = {
  name: 'channels',
  requires: ['messaging', 'contacts', 'drive'],
  web: { routes: { basePath: '/api/channels', handler: handlers } },
  jobs: [],
  init(ctx) {
    installChannelsState(
      createChannelsState({
        jobs: ctx.jobs as unknown as JobQueue,
        realtime: ctx.realtime,
        auth: ctx.auth,
      }),
    )
    installChannelInstancesService(createChannelInstancesService({ db: ctx.db }))
    installWebInstancesService(createWebInstancesService({ db: ctx.db }))

    registerAdapter(WEB_CHANNEL_NAME, createWebAdapter, WEB_CAPABILITIES)
    registerAdapter(WHATSAPP_CHANNEL_NAME, createWhatsAppAdapterFromConfig, WHATSAPP_CAPABILITIES)
  },
}

export default channels

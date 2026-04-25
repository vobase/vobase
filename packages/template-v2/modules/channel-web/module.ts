/**
 * Channel-web module — exposes the inbound widget webhook + outbound dispatcher
 * as a `ModuleDef`. Boots after messaging/contacts/drive so its handlers can
 * call those services directly.
 */
import type { ModuleDef } from '~/runtime'
import handlers from './handlers'
import { createWebInstancesService, installWebInstancesService } from './service/instances'
import { createChannelWebState, installChannelWebState, type JobQueue } from './service/state'

const channelWeb: ModuleDef = {
  name: 'channel-web',
  requires: ['messaging', 'contacts', 'drive'],
  web: { routes: { basePath: '/api/channel-web', handler: handlers } },
  jobs: [],
  init(ctx) {
    installChannelWebState(
      createChannelWebState({
        jobs: ctx.jobs as unknown as JobQueue,
        realtime: ctx.realtime,
        auth: ctx.auth,
      }),
    )
    installWebInstancesService(createWebInstancesService({ db: ctx.db }))
  },
}

export default channelWeb

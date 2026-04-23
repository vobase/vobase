import type { ModuleDef } from '@server/common/module-def'
import handlers from './handlers'
import { createWebInstancesService, installWebInstancesService } from './service/instances'
import { createChannelWebState, installChannelWebState, type JobQueue } from './service/state'

const channelWeb: ModuleDef = {
  name: 'channel-web',
  requires: ['inbox', 'contacts', 'drive'],
  // Inbound webhook is HMAC-authed (no session gate). Always enabled — web is
  // the default customer surface. In production, CHANNEL_WEB_WEBHOOK_SECRET
  // must be set (enforced in handlers/inbound.ts).
  routes: { basePath: '/api/channel-web', handler: handlers },
  init(ctx) {
    installChannelWebState(
      createChannelWebState({
        jobs: ctx.jobs as JobQueue,
        realtime: ctx.realtime,
      }),
    )
    installWebInstancesService(createWebInstancesService({ db: ctx.db }))
  },
}

export default channelWeb

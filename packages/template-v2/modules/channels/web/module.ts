import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { createWebInstancesService, installWebInstancesService } from './service/instances'
import { createChannelWebState, installChannelWebState, type JobQueue } from './service/state'

export default defineModule({
  name: 'channel-web',
  version: '1.0',
  requires: ['inbox', 'contacts', 'drive'],
  manifest: {
    provides: {
      channels: ['web'],
    },
    permissions: [],
    workspace: { owns: [] },
  },
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
})

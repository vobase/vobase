import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { createChannelWebState, installChannelWebState, type JobQueue } from './service/state'

export default defineModule({
  name: 'channel-web',
  version: '1.0',
  requires: ['inbox', 'contacts', 'drive'],
  manifest,
  // Inbound webhook is HMAC-authed (no session gate). Always enabled — web is
  // the default customer surface. In production, CHANNEL_WEB_WEBHOOK_SECRET
  // must be set (enforced in handlers/inbound.ts).
  routes: { basePath: '/api/channel-web', handler: handlers },
  init(ctx) {
    installChannelWebState(
      createChannelWebState({
        inbox: ctx.ports.inbox,
        contacts: ctx.ports.contacts,
        jobs: ctx.jobs as JobQueue,
        realtime: ctx.realtime,
      }),
    )
  },
})

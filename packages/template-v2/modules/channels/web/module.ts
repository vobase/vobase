import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { createChannelWebState, installChannelWebState, type JobQueue } from './service/state'

export default defineModule({
  name: 'channel-web',
  version: '1.0',
  requires: ['inbox', 'contacts', 'drive'],
  manifest,
  // Inbound webhook is HMAC-authed (no session gate). The /test-web dogfood
  // page is dev-only — prod builds skip the whole module.
  routes: { basePath: '/api/channel-web', handler: handlers },
  enabled: (env) => env.NODE_ENV !== 'production',
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

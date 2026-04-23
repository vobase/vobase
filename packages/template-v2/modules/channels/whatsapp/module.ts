import type { ModuleDef } from '@server/common/module-def'
import handlers from './handlers'
import { createChannelWhatsappState, installChannelWhatsappState, type JobQueue } from './service/state'

const channelWhatsapp: ModuleDef = {
  name: 'channel-whatsapp',
  requires: ['messaging', 'contacts', 'drive'],
  // Meta authenticates via X-Hub-Signature-256 HMAC, not session cookies.
  routes: { basePath: '/api/channel-whatsapp', handler: handlers },
  init(ctx) {
    installChannelWhatsappState(
      createChannelWhatsappState({
        jobs: ctx.jobs as JobQueue,
        realtime: ctx.realtime,
      }),
    )
  },
}

export default channelWhatsapp

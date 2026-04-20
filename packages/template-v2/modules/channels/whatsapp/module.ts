import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { createChannelWhatsappState, installChannelWhatsappState, type JobQueue } from './service/state'

export default defineModule({
  name: 'channel-whatsapp',
  version: '1.0',
  requires: ['inbox', 'contacts', 'drive'],
  manifest,
  // Meta authenticates via X-Hub-Signature-256 HMAC, not session cookies.
  routes: { basePath: '/api/channel-whatsapp', handler: handlers },
  init(ctx) {
    installChannelWhatsappState(
      createChannelWhatsappState({
        inbox: ctx.ports.inbox,
        contacts: ctx.ports.contacts,
        jobs: ctx.jobs as JobQueue,
        realtime: ctx.realtime,
      }),
    )
  },
})

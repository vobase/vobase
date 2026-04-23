import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { createChannelWhatsappState, installChannelWhatsappState, type JobQueue } from './service/state'

export default defineModule({
  name: 'channel-whatsapp',
  version: '1.0',
  requires: ['inbox', 'contacts', 'drive'],
  manifest: {
    provides: {
      channels: ['whatsapp'],
    },
    permissions: [],
    workspace: { owns: [] },
  },
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
})

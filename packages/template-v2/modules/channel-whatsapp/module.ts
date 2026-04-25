/**
 * Channel-whatsapp module — Meta-authenticated webhook + outbound sender.
 * Boots after messaging/contacts so inbound parser + dispatcher can call
 * those services directly. No `requireSession` on web.routes — Meta
 * authenticates with `X-Hub-Signature-256` headers, not session cookies.
 */
import type { ModuleDef } from '~/runtime'
import handlers from './handlers'
import { createChannelWhatsappState, installChannelWhatsappState, type JobQueue } from './service/state'

const channelWhatsapp: ModuleDef = {
  name: 'channel-whatsapp',
  requires: ['messaging', 'contacts'],
  web: { routes: { basePath: '/api/channel-whatsapp', handler: handlers } },
  jobs: [],
  init(ctx) {
    installChannelWhatsappState(
      createChannelWhatsappState({
        jobs: ctx.jobs as unknown as JobQueue,
        realtime: ctx.realtime,
      }),
    )
  },
}

export default channelWhatsapp

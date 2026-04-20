import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { type JobQueue, setContactsPort, setInboxPort, setJobQueue, setRealtime } from './service/state'

export default defineModule({
  name: 'channel-whatsapp',
  version: '1.0',
  requires: ['inbox', 'contacts', 'drive'],
  manifest,
  // Meta authenticates via X-Hub-Signature-256 HMAC, not session cookies.
  routes: { basePath: '/api/channel-whatsapp', handler: handlers },
  init(ctx) {
    setInboxPort(ctx.ports.inbox)
    setContactsPort(ctx.ports.contacts)
    setJobQueue(ctx.jobs as JobQueue)
    setRealtime(ctx.realtime)
  },
})

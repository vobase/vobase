import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { type JobQueue, setContactsPort, setInboxPort, setJobQueue, setRealtime } from './service/state'

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
    setInboxPort(ctx.ports.inbox)
    setContactsPort(ctx.ports.contacts)
    setJobQueue(ctx.jobs as JobQueue)
    setRealtime(ctx.realtime)
  },
})

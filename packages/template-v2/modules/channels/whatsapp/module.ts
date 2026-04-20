import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'
import { type JobQueue, setContactsPort, setInboxPort, setJobQueue, setRealtime } from './service/state'

export default defineModule({
  name: 'channel-whatsapp',
  version: '1.0',
  requires: ['inbox', 'contacts', 'drive'],
  manifest,
  init(ctx) {
    setInboxPort(ctx.ports.inbox)
    setContactsPort(ctx.ports.contacts)
    setJobQueue(ctx.jobs as JobQueue)
    setRealtime(ctx.realtime)
  },
})

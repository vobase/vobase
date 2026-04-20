import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { setDb as setContactsDb } from './service/contacts'

export default defineModule({
  name: 'contacts',
  version: '1.0',
  manifest,
  routes: { basePath: '/api/contacts', handler: handlers, requireSession: true },
  init(ctx) {
    setContactsDb(ctx.db)
  },
})

import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { createContactsService, installContactsService } from './service/contacts'

export default defineModule({
  name: 'contacts',
  version: '1.0',
  manifest,
  routes: { basePath: '/api/contacts', handler: handlers, requireSession: true },
  init(ctx) {
    installContactsService(createContactsService({ db: ctx.db }))
  },
})

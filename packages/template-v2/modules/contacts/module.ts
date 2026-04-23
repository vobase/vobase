import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { createAttrDefService, installAttrDefService } from './service/attribute-definitions'
import { createContactsService, installContactsService } from './service/contacts'

export default defineModule({
  name: 'contacts',
  version: '1.0',
  manifest: {
    provides: {
      commands: ['contacts:get', 'contacts:list', 'contacts:search'],
      materializers: ['contactProfileMaterializer', 'contactMemoryMaterializer'],
    },
    permissions: [],
    workspace: { owns: [] },
  },
  routes: { basePath: '/api/contacts', handler: handlers, requireSession: true },
  init(ctx) {
    installContactsService(createContactsService({ db: ctx.db }))
    installAttrDefService(createAttrDefService({ db: ctx.db }))
  },
})

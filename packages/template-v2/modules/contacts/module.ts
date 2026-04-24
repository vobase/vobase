import type { ModuleDef } from '@server/common/module-def'

import handlers from './handlers'
import { createAttrDefService, installAttrDefService } from './service/attribute-definitions'
import { createContactsService, installContactsService } from './service/contacts'

const contacts: ModuleDef = {
  name: 'contacts',
  routes: { basePath: '/api/contacts', handler: handlers, requireSession: true },
  init(ctx) {
    installContactsService(createContactsService({ db: ctx.db }))
    installAttrDefService(createAttrDefService({ db: ctx.db }))
  },
}

export default contacts

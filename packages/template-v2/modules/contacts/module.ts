import type { ModuleDef } from '~/runtime'
import { registerContactsVerbs } from './cli'
import { createAttrDefService, installAttrDefService } from './service/attribute-definitions'
import { createContactsService, installContactsService } from './service/contacts'
import * as web from './web'

const contacts: ModuleDef = {
  name: 'contacts',
  web: { routes: web.routes },
  jobs: [],
  init(ctx) {
    installContactsService(createContactsService({ db: ctx.db }))
    installAttrDefService(createAttrDefService({ db: ctx.db }))
    registerContactsVerbs(ctx.cli)
  },
}

export default contacts

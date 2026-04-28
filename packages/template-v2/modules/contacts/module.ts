import { registerChangeMaterializer } from '@modules/changes/service/proposals'

import type { ModuleDef } from '~/runtime'
import { contactsVerbs } from './cli'
import { createAttrDefService, installAttrDefService } from './service/attribute-definitions'
import { CONTACT_RESOURCE, contactChangeMaterializer } from './service/changes'
import { createContactsService, installContactsService } from './service/contacts'
import * as web from './web'

const contacts: ModuleDef = {
  name: 'contacts',
  web: { routes: web.routes },
  jobs: [],
  init(ctx) {
    installContactsService(createContactsService({ db: ctx.db, realtime: ctx.realtime }))
    installAttrDefService(createAttrDefService({ db: ctx.db }))
    registerChangeMaterializer({
      resourceModule: CONTACT_RESOURCE.module,
      resourceType: CONTACT_RESOURCE.type,
      requiresApproval: false,
      materialize: contactChangeMaterializer,
    })
    ctx.cli.registerAll(contactsVerbs)
  },
}

export default contacts

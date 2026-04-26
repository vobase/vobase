import { defineViewable } from '@vobase/core'

import type { ModuleDef } from '~/runtime'
import { contacts as contactsTable } from './schema'
import { createAttrDefService, installAttrDefService } from './service/attribute-definitions'
import { createContactsService, installContactsService } from './service/contacts'
import * as web from './web'

// Register the contacts viewable at module-load time so the views module
// (which boots after) sees it on first `views.query`.
defineViewable({
  scope: 'object:contacts',
  table: contactsTable,
  columns: [
    { name: 'id', type: 'text', label: 'ID', filterable: true, sortable: true },
    { name: 'displayName', type: 'text', label: 'Name', filterable: true, sortable: true },
    { name: 'phone', type: 'text', label: 'Phone', filterable: true, sortable: true },
    { name: 'email', type: 'text', label: 'Email', filterable: true, sortable: true },
    { name: 'segments', type: 'json', label: 'Segments', filterable: true, sortable: false },
    { name: 'marketingOptOut', type: 'boolean', label: 'Opted out', filterable: true, sortable: true },
    { name: 'createdAt', type: 'date', label: 'Created', filterable: true, sortable: true },
    { name: 'updatedAt', type: 'date', label: 'Updated', filterable: true, sortable: true },
  ],
  defaultView: {
    columns: ['displayName', 'phone', 'email', 'segments', 'updatedAt'],
    sort: [{ column: 'updatedAt', direction: 'desc' }],
  },
})

const contacts: ModuleDef = {
  name: 'contacts',
  web: { routes: web.routes },
  jobs: [],
  init(ctx) {
    installContactsService(createContactsService({ db: ctx.db }))
    installAttrDefService(createAttrDefService({ db: ctx.db }))
  },
}

export default contacts

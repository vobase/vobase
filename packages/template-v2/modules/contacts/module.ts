import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'
import { setDb as setContactsDb } from './service/contacts'

export default defineModule({
  name: 'contacts',
  version: '1.0',
  manifest,
  init(ctx) {
    setContactsDb(ctx.db)
  },
})

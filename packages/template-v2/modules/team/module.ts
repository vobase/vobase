import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { createStaffAttrDefService, installStaffAttrDefService } from './service/attribute-definitions'
import { createStaffService, installStaffService } from './service/staff'

export default defineModule({
  name: 'team',
  version: '1.0',
  requires: ['contacts'],
  manifest,
  routes: { basePath: '/api/team', handler: handlers, requireSession: true },
  init(ctx) {
    installStaffService(createStaffService({ db: ctx.db }))
    installStaffAttrDefService(createStaffAttrDefService({ db: ctx.db }))
  },
})

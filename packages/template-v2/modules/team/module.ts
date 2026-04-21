import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { createStaffAttrDefService, installStaffAttrDefService } from './service/attribute-definitions'
import { createStaffService, installStaffService } from './service/staff'
import { createTeamDescriptionService, installTeamDescriptionService } from './service/team-descriptions'

export default defineModule({
  name: 'team',
  version: '1.0',
  requires: ['contacts'],
  manifest,
  routes: { basePath: '/api/team', handler: handlers, requireSession: true },
  init(ctx) {
    installStaffService(createStaffService({ db: ctx.db }))
    installStaffAttrDefService(createStaffAttrDefService({ db: ctx.db }))
    installTeamDescriptionService(createTeamDescriptionService({ db: ctx.db }))
  },
})

import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { createStaffAttrDefService, installStaffAttrDefService } from './service/attribute-definitions'
import { createMentionNotifyService, installMentionNotifyService } from './service/mention-notify'
import { createMentionsService, installMentionsService } from './service/mentions'
import { createStaffService, installStaffService } from './service/staff'
import { createTeamDescriptionService, installTeamDescriptionService } from './service/team-descriptions'

export default defineModule({
  name: 'team',
  version: '1.0',
  requires: ['contacts', 'settings'],
  manifest: {
    provides: {
      commands: ['team:staff:list', 'team:staff:get'],
    },
    permissions: [],
    workspace: { owns: [] },
  },
  routes: { basePath: '/api/team', handler: handlers, requireSession: true },
  init(ctx) {
    installStaffService(createStaffService({ db: ctx.db }))
    installStaffAttrDefService(createStaffAttrDefService({ db: ctx.db }))
    installTeamDescriptionService(createTeamDescriptionService({ db: ctx.db }))
    installMentionsService(createMentionsService({ db: ctx.db }))
    installMentionNotifyService(createMentionNotifyService({ db: ctx.db }))
  },
})

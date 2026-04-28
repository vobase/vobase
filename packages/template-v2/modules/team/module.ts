import { registerDriveOverlay } from '@modules/drive/service/overlays'

import type { ModuleDef } from '~/runtime'
import { createStaffAttrDefService, installStaffAttrDefService } from './service/attribute-definitions'
import { staffCrossAgentMemoryOverlay } from './service/drive-overlay'
import { createMentionNotifyService, installMentionNotifyService } from './service/mention-notify'
import { createMentionsService, installMentionsService } from './service/mentions'
import { createStaffService, installStaffService } from './service/staff'
import { createTeamDescriptionService, installTeamDescriptionService } from './service/team-descriptions'
import * as web from './web'

const team: ModuleDef = {
  name: 'team',
  requires: ['contacts', 'settings', 'drive', 'agents'],
  web: { routes: web.routes },
  jobs: [],
  init(ctx) {
    installStaffService(createStaffService({ db: ctx.db }))
    installStaffAttrDefService(createStaffAttrDefService({ db: ctx.db }))
    installTeamDescriptionService(createTeamDescriptionService({ db: ctx.db }))
    installMentionsService(createMentionsService({ db: ctx.db }))
    installMentionNotifyService(createMentionNotifyService({ db: ctx.db }))
    registerDriveOverlay(staffCrossAgentMemoryOverlay)
  },
}

export default team

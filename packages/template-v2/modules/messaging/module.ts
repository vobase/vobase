import type { ModuleDef } from '~/runtime'
import { jobs } from './jobs'
import {
  type ConversationScheduler,
  createConversationsService,
  installConversationsService,
} from './service/conversations'
import { createMessagesService, installMessagesService } from './service/messages'
import { createNotesService, installNotesService } from './service/notes'
import {
  type ApprovalScheduler,
  createPendingApprovalsService,
  installPendingApprovalsService,
} from './service/pending-approvals'
import { createStaffOpsService, installStaffOpsService } from './service/staff-ops'
import * as web from './web'

export type { ApprovalScheduler, ConversationScheduler }

const messaging: ModuleDef = {
  name: 'messaging',
  requires: ['contacts'],
  web: { routes: web.routes },
  // No static agent tools — concierge-facing tools moved to
  // `modules/agents/tools/concierge/` per the dual-surface tool partition.
  // The concierge wake-config wires them in directly.
  jobs: [...jobs],
  init(ctx) {
    const conversationScheduler = (ctx.jobs as unknown as ConversationScheduler | undefined) ?? null
    installConversationsService(createConversationsService({ db: ctx.db, scheduler: conversationScheduler }))
    installPendingApprovalsService(createPendingApprovalsService({ db: ctx.db }))
    installMessagesService(createMessagesService({ db: ctx.db }))
    installNotesService(createNotesService({ db: ctx.db }))
    installStaffOpsService(createStaffOpsService({ db: ctx.db }))
  },
}

export default messaging

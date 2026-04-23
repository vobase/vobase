import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
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
import { inboxTools } from './tools'

export type { ApprovalScheduler, ConversationScheduler }

export default defineModule({
  name: 'inbox',
  version: '1.0',
  requires: ['contacts'],
  manifest,
  routes: { basePath: '/api/inbox', handler: handlers, requireSession: true },
  init(ctx) {
    const conversationScheduler = (ctx.jobs as unknown as ConversationScheduler | undefined) ?? null
    installConversationsService(createConversationsService({ db: ctx.db, scheduler: conversationScheduler }))
    installPendingApprovalsService(createPendingApprovalsService({ db: ctx.db }))
    installMessagesService(createMessagesService({ db: ctx.db }))
    installNotesService(createNotesService({ db: ctx.db }))
    installStaffOpsService(createStaffOpsService({ db: ctx.db }))

    for (const tool of inboxTools) {
      ctx.registerTool(tool as never)
    }
  },
})

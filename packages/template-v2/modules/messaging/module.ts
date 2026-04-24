import type { ModuleDef } from '@server/common/module-def'

import handlers from './handlers'
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

/**
 * Tools are re-exported for the wake harness's direct consumption —
 * `server/wake-handler.ts` imports `messagingTools` when building the per-wake
 * `registrations.tools` bag. Module init doesn't register tools anymore.
 */
export { messagingTools } from './tools'
export type { ApprovalScheduler, ConversationScheduler }

const messaging: ModuleDef = {
  name: 'messaging',
  requires: ['contacts'],
  routes: { basePath: '/api/messaging', handler: handlers, requireSession: true },
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

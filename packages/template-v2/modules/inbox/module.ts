import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { approvalMutator } from './mutators/approval'
import {
  type ConversationScheduler,
  setDb as setConversationsDb,
  setScheduler as setConversationsScheduler,
} from './service/conversations'
import { setDb as setMessagesDb } from './service/messages'
import { setDb as setNotesDb } from './service/notes'
import {
  setDb as setPendingApprovalsDb,
  setScheduler as setPendingApprovalsScheduler,
} from './service/pending-approvals'
import { setDb as setStaffOpsDb } from './service/staff-ops'
import { inboxTools } from './tools'

export { setConversationsScheduler, setPendingApprovalsScheduler }

export default defineModule({
  name: 'inbox',
  version: '1.0',
  requires: ['contacts'],
  manifest,
  routes: { basePath: '/api/inbox', handler: handlers, requireSession: true },
  init(ctx) {
    setConversationsDb(ctx.db)
    setPendingApprovalsDb(ctx.db)
    setMessagesDb(ctx.db)
    setNotesDb(ctx.db)
    setStaffOpsDb(ctx.db)

    // Snooze wake enqueue/cancel. ctx.jobs exposes a pg-boss-shaped handle;
    // we adapt it to the narrow `ConversationScheduler` interface so the
    // service layer doesn't depend on pg-boss types directly.
    if (ctx.jobs) {
      setConversationsScheduler(ctx.jobs as unknown as ConversationScheduler)
    }

    ctx.registerMutator(approvalMutator)
    for (const tool of inboxTools) {
      // Cast: PluginContext.registerTool uses the Phase-1 AgentTool stub; unifies in Phase 3.
      ctx.registerTool(tool as never)
    }
  },
})

import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'
import { approvalMutator } from './mutators/approval'
import { setDb as setConversationsDb } from './service/conversations'
import { setDb as setMessagesDb } from './service/messages'
import {
  setDb as setPendingApprovalsDb,
  setScheduler as setPendingApprovalsScheduler,
} from './service/pending-approvals'
import { inboxTools } from './tools'

export { setPendingApprovalsScheduler }

export default defineModule({
  name: 'inbox',
  version: '1.0',
  requires: ['contacts'],
  manifest,
  init(ctx) {
    setConversationsDb(ctx.db)
    setPendingApprovalsDb(ctx.db)
    setMessagesDb(ctx.db)
    ctx.registerMutator(approvalMutator)
    for (const tool of inboxTools) {
      // Cast: PluginContext.registerTool uses the Phase-1 AgentTool stub; unifies in Phase 3.
      ctx.registerTool(tool as never)
    }
  },
})

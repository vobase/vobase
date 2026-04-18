import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'
import { auditObserver } from './observers/audit'
import { sseObserver } from './observers/sse'
import { setDb as setAgentDefsDb } from './service/agent-definitions'
import { setDb as setJournalDb } from './service/journal'
import { setDb as setLearningProposalsDb } from './service/learning-proposals'
import { subagentTool } from './tools/subagent'

export default defineModule({
  name: 'agents',
  version: '1.0',
  requires: ['inbox', 'contacts', 'drive'],
  manifest,
  init(ctx) {
    setJournalDb(ctx.db)
    setAgentDefsDb(ctx.db)
    setLearningProposalsDb(ctx.db)
    ctx.registerObserver(auditObserver)
    ctx.registerObserver(sseObserver)
    // Cast: PluginContext.registerTool uses the Phase-1 AgentTool stub (ToolExecutionContext);
    // the full AgentTool<T,R> (ToolContext with approvalDecision) unifies in Phase 3.
    ctx.registerTool(subagentTool as never)
  },
})

import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'
import { moderationMutator } from './mutators/moderation'
import { auditObserver } from './observers/audit'
import { createScorerObserver } from './observers/scorer'
import { sseObserver } from './observers/sse'
import { setDb as setAgentDefsDb } from './service/agent-definitions'
import { setDb as setJournalDb } from './service/journal'
import {
  createLearningNotifier,
  setNotifier as setLearningNotifier,
  setDb as setLearningProposalsDb,
} from './service/learning-proposals'
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
    setLearningNotifier(createLearningNotifier(ctx.db))
    ctx.registerObserver(auditObserver)
    ctx.registerObserver(sseObserver)

    // Moderation + scorer are opt-in: gated by VOBASE_ENABLE_MODERATION=true so Phase-2
    // dogfood fixture replays stay deterministic in CI (plan §P3.0).
    if (process.env.VOBASE_ENABLE_MODERATION === 'true') {
      ctx.registerMutator(moderationMutator)
      ctx.registerObserver(
        createScorerObserver({
          llmCall: ctx.llmCall,
          emit: (event) => ctx.events.publish(event),
        }),
      )
    }

    // Cast: PluginContext.registerTool uses the Phase-1 AgentTool stub (ToolExecutionContext);
    // the full AgentTool<T,R> (ToolContext with approvalDecision) unifies in Phase 3.
    ctx.registerTool(subagentTool as never)
  },
})

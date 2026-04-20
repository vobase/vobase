import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { moderationMutator } from './mutators/moderation'
import { auditObserver } from './observers/audit'
import { createCostAggregatorObserver } from './observers/cost-aggregator'
import { createScorerObserver } from './observers/scorer'
import { sseObserver } from './observers/sse'
import { setDb as setAgentDefsDb } from './service/agent-definitions'
import { setCostDb } from './service/cost'
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
  routes: { basePath: '/api/agents', handler: handlers, requireSession: true },
  init(ctx) {
    setJournalDb(ctx.db)
    setAgentDefsDb(ctx.db)
    setLearningProposalsDb(ctx.db)
    setCostDb(ctx.db)
    ctx.registerObserver(createCostAggregatorObserver())
    setLearningNotifier(createLearningNotifier(ctx.db))
    ctx.registerObserver(auditObserver)
    ctx.registerObserver(sseObserver)

    // Moderation + scorer are opt-in: gated by VOBASE_ENABLE_MODERATION=true so Phase-2
    // dogfood fixture replays stay deterministic in CI.
    //
    // NOTE: `ctx.llmCall` / `ctx.events.publish` are boot-time throw-proxies —
    // the scorer observer captures them eagerly, so enabling moderation under
    // the current boot path will throw at wake time. When moderation is wired
    // for real, the observer needs to resolve these lazily from the per-wake
    // context (e.g. via a registry keyed on wakeId) rather than capturing at
    // register time. Leaving the capture here to keep the intent visible.
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

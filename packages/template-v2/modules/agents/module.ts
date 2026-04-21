import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { moderationMutator } from './mutators/moderation'
import { auditObserver } from './observers/audit'
import { createCostAggregatorObserver } from './observers/cost-aggregator'
import { createScorerObserver } from './observers/scorer'
import { sseObserver } from './observers/sse'
import { createAgentDefinitionsService, installAgentDefinitionsService } from './service/agent-definitions'
import { createCostService, installCostService } from './service/cost'
import { createJournalService, installJournalService } from './service/journal'
import {
  createLearningNotifier,
  createLearningProposalsService,
  installLearningProposalsService,
} from './service/learning-proposals'
import { subagentTool } from './tools/subagent'

export default defineModule({
  name: 'agents',
  version: '1.0',
  requires: ['inbox', 'contacts', 'drive'],
  manifest,
  routes: { basePath: '/api/agents', handler: handlers, requireSession: true },
  init(ctx) {
    installJournalService(createJournalService({ db: ctx.db }))
    installAgentDefinitionsService(createAgentDefinitionsService({ db: ctx.db }))
    installLearningProposalsService(
      createLearningProposalsService({ db: ctx.db, notifier: createLearningNotifier(ctx.db) }),
    )
    installCostService(createCostService({ db: ctx.db }))
    ctx.registerObserver(createCostAggregatorObserver())
    ctx.registerObserver(auditObserver)
    ctx.registerObserver(sseObserver)

    // Moderation + scorer are opt-in: gated by VOBASE_ENABLE_MODERATION=true so Phase-2
    // dogfood fixture replays stay deterministic in CI.
    //
    // Scorer needs per-wake `llmCall` + `events.publish`, which are boot-time throw-proxies.
    // Registered as an observer FACTORY so the harness hands it a live WakeContext per wake.
    if (process.env.VOBASE_ENABLE_MODERATION === 'true') {
      ctx.registerMutator(moderationMutator)
      ctx.registerObserverFactory((wake) =>
        createScorerObserver({
          llmCall: wake.llmCall,
          emit: (event) => ctx.events.publish(event),
        }),
      )
    }

    ctx.registerTool(subagentTool)
  },
})

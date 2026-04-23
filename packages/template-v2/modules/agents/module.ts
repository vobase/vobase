import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
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
    ctx.registerObserver(sseObserver)
    ctx.registerTool(subagentTool)
  },
})

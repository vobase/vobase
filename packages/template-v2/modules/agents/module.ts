import type { ModuleDef } from '@server/common/module-def'
import { createCostService, createJournalService, installCostService, installJournalService } from '@vobase/core'

import handlers from './handlers'
import { createAgentDefinitionsService, installAgentDefinitionsService } from './service/agent-definitions'
import {
  createLearningNotifier,
  createLearningProposalsService,
  installLearningProposalsService,
} from './service/learning-proposals'
import { createStaffMemoryService, installStaffMemoryService } from './service/staff-memory'

/**
 * Named exports of the agent module's tools + listeners. `server/wake-handler.ts`
 * composes these into the per-wake `registrations` bag; module init no longer
 * registers them through a `PluginContext` surface.
 */
export { sseListener } from './observers/sse'
export { subagentTool } from './tools/subagent'

const agents: ModuleDef = {
  name: 'agents',
  requires: ['messaging', 'contacts', 'drive'],
  routes: { basePath: '/api/agents', handler: handlers, requireSession: true },
  init(ctx) {
    installJournalService(createJournalService({ db: ctx.db }))
    installAgentDefinitionsService(createAgentDefinitionsService({ db: ctx.db }))
    installLearningProposalsService(
      createLearningProposalsService({ db: ctx.db, notifier: createLearningNotifier(ctx.db) }),
    )
    installCostService(createCostService({ db: ctx.db }))
    installStaffMemoryService(createStaffMemoryService({ db: ctx.db }))
  },
}

export default agents

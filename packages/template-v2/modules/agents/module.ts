import type { ModuleDef } from '@server/common/module-def'
import { createCostService, createJournalService, installCostService, installJournalService } from '@vobase/core'

import * as agent from './agent'
import { jobs } from './jobs'
import { createAgentDefinitionsService, installAgentDefinitionsService } from './service/agent-definitions'
import {
  createLearningNotifier,
  createLearningProposalsService,
  installLearningProposalsService,
} from './service/learning-proposals'
import { createStaffMemoryService, installStaffMemoryService } from './service/staff-memory'
import * as web from './web'

const agents: ModuleDef = {
  name: 'agents',
  requires: ['messaging', 'contacts', 'drive'],
  web: { routes: web.routes },
  agent: { tools: agent.tools },
  jobs: [...jobs],
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

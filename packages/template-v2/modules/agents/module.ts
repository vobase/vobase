import {
  createCostService,
  createJournalService,
  installCostService,
  installJournalService,
  setApprovalGateDb,
} from '@vobase/core'

import type { ModuleDef } from '~/runtime'
import * as agent from './agent'
import { agentsVerbs } from './cli'
import { EXPIRE_APPROVALS_CRON, EXPIRE_APPROVALS_JOB, jobs } from './jobs'
import { memoryVerbs } from './memory-cli'
import { createAgentDefinitionsService, installAgentDefinitionsService } from './service/agent-definitions'
import {
  createLearningNotifier,
  createLearningProposalsService,
  installLearningProposalsService,
} from './service/learning-proposals'
import { createStaffMemoryService, installStaffMemoryService } from './service/staff-memory'
import { createAgentsState, installAgentsState } from './service/state'
import { createThreadsService, installThreadsService } from './service/threads'
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
    installThreadsService(createThreadsService({ db: ctx.db, notify: (payload) => ctx.realtime.notify(payload) }))
    installAgentsState(createAgentsState({ jobs: ctx.jobs }))
    setApprovalGateDb(ctx.db)
    void ctx.jobs.schedule?.(EXPIRE_APPROVALS_JOB, EXPIRE_APPROVALS_CRON, undefined, {
      singletonKey: EXPIRE_APPROVALS_JOB,
    })
    ctx.cli.registerAll(agentsVerbs)
    ctx.cli.registerAll(memoryVerbs)
  },
}

export default agents

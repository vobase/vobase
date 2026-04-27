import { registerChangeMaterializer } from '@modules/changes/service/proposals'
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
  AGENT_MEMORY_RESOURCE,
  AGENT_SKILL_RESOURCE,
  agentMemoryMaterializer,
  agentSkillMaterializer,
  createAgentSkillsService,
  installAgentSkillsService,
} from './service/changes'
import { createStaffMemoryService, installStaffMemoryService } from './service/staff-memory'
import { createAgentsState, installAgentsState } from './service/state'
import { createThreadsService, installThreadsService } from './service/threads'
import * as web from './web'

const agents: ModuleDef = {
  name: 'agents',
  requires: ['messaging', 'contacts', 'drive', 'changes'],
  web: { routes: web.routes },
  agent: { tools: agent.tools },
  jobs: [...jobs],
  init(ctx) {
    installJournalService(createJournalService({ db: ctx.db }))
    installAgentDefinitionsService(createAgentDefinitionsService({ db: ctx.db }))
    installAgentSkillsService(createAgentSkillsService({ db: ctx.db }))
    installCostService(createCostService({ db: ctx.db }))
    installStaffMemoryService(createStaffMemoryService({ db: ctx.db }))
    installThreadsService(createThreadsService({ db: ctx.db, notify: (payload) => ctx.realtime.notify(payload) }))
    installAgentsState(createAgentsState({ jobs: ctx.jobs }))
    setApprovalGateDb(ctx.db)
    registerChangeMaterializer({
      resourceModule: AGENT_SKILL_RESOURCE.module,
      resourceType: AGENT_SKILL_RESOURCE.type,
      requiresApproval: true,
      materialize: agentSkillMaterializer,
    })
    registerChangeMaterializer({
      resourceModule: AGENT_MEMORY_RESOURCE.module,
      resourceType: AGENT_MEMORY_RESOURCE.type,
      requiresApproval: false,
      materialize: agentMemoryMaterializer,
    })
    void ctx.jobs.schedule?.(EXPIRE_APPROVALS_JOB, EXPIRE_APPROVALS_CRON, undefined, {
      singletonKey: EXPIRE_APPROVALS_JOB,
    })
    ctx.cli.registerAll(agentsVerbs)
    ctx.cli.registerAll(memoryVerbs)
  },
}

export default agents

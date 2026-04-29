import { registerChangeMaterializer } from '@modules/changes/service/proposals'
import { registerDriveOverlay } from '@modules/drive/service/overlays'
import { createCostService, installCostService, setApprovalGateDb } from '@vobase/core'

import type { ModuleDef } from '~/runtime'
import { agentsAgentsMdContributors, agentsMaterializerFactory, agentsRoHints } from './agent'
import { agentsVerbs } from './cli'
import { EXPIRE_APPROVALS_CRON, EXPIRE_APPROVALS_JOB, jobs } from './jobs'
import { createAgentDefinitionsService, installAgentDefinitionsService } from './service/agent-definitions'
import {
  AGENT_MEMORY_RESOURCE,
  AGENT_SKILL_RESOURCE,
  agentMemoryMaterializer,
  agentSkillMaterializer,
  createAgentSkillsService,
  installAgentSkillsService,
} from './service/changes'
import { setCliRegistry } from './service/cli-registry'
import { agentSkillsOverlay } from './service/drive-overlay'
import { createStaffMemoryService, installStaffMemoryService } from './service/staff-memory'
import { createAgentsState, installAgentsState } from './service/state'
import { createThreadsService, installThreadsService } from './service/threads'
import * as web from './web'

const agents: ModuleDef = {
  name: 'agents',
  requires: ['messaging', 'contacts', 'drive', 'changes'],
  web: { routes: web.routes },
  jobs: [...jobs],
  agent: {
    agentsMd: [...agentsAgentsMdContributors],
    materializers: [agentsMaterializerFactory],
    roHints: [...agentsRoHints],
  },
  init(ctx) {
    // Journal service is bound bootstrap-tier (`runtime/bootstrap.ts::setJournalDb`)
    // because every wake harness needs it before any module init runs.
    setCliRegistry(ctx.cli)
    installAgentDefinitionsService(createAgentDefinitionsService({ db: ctx.db }))
    installAgentSkillsService(createAgentSkillsService({ db: ctx.db }))
    installCostService(createCostService({ db: ctx.db }))
    installStaffMemoryService(createStaffMemoryService({ db: ctx.db, realtime: ctx.realtime }))
    installThreadsService(createThreadsService({ db: ctx.db, notify: (payload) => ctx.realtime.notify(payload) }))
    installAgentsState(createAgentsState({ jobs: ctx.jobs }))
    setApprovalGateDb(ctx.db)
    registerDriveOverlay(agentSkillsOverlay)
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
  },
}

export default agents

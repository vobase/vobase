/**
 * `automations` module — owns `automation_rules` and the cron-tick job that
 * synthesises heartbeat triggers for the agents pipeline.
 *
 * Depends on `agents` so the automations service can reference agent ids; the
 * cron-tick handler delegates heartbeat emission to a hook the agents module
 * provides at boot via `setHeartbeatEmitter` (re-exported here for ergonomic
 * downstream import). Without an emitter installed the tick runs but emits
 * nothing — useful for tests that exercise schedule mutation only.
 */

import { AUTOMATIONS_TICK_CRON, AUTOMATIONS_TICK_JOB, jobs } from '@modules/automations/jobs'
import { createAutomationsService, installAutomationsService } from '@modules/automations/service/automations'

import type { ModuleDef } from '~/runtime'
import { automationsTools } from './agent'
import { automationsVerbs } from './cli'

export {
  __resetHeartbeatEmitterForTests,
  setHeartbeatEmitter,
} from '@modules/automations/service/heartbeat-emitter'

const automations: ModuleDef = {
  name: 'automations',
  requires: ['agents'],
  jobs: [...jobs],
  agent: { tools: automationsTools },
  init(ctx) {
    installAutomationsService(createAutomationsService({ db: ctx.db }))
    void ctx.jobs.schedule?.(AUTOMATIONS_TICK_JOB, AUTOMATIONS_TICK_CRON, undefined, {
      singletonKey: AUTOMATIONS_TICK_JOB,
    })
    ctx.cli.registerAll(automationsVerbs)
  },
}

export default automations

/**
 * `schedules` module — owns `agent_schedules` and the cron-tick job that
 * synthesises heartbeat triggers for the agents pipeline.
 *
 * Depends on `agents` so the schedules service can reference agent ids; the
 * cron-tick handler delegates heartbeat emission to a hook the agents module
 * provides at boot via `setHeartbeatEmitter` (re-exported here for ergonomic
 * downstream import). Without an emitter installed the tick runs but emits
 * nothing — useful for tests that exercise schedule mutation only.
 */

import { jobs, SCHEDULES_TICK_CRON, SCHEDULES_TICK_JOB } from '@modules/schedules/jobs'
import { createSchedulesService, installSchedulesService } from '@modules/schedules/service/schedules'

import type { ModuleDef } from '~/runtime'
import { schedulesVerbs } from './cli'

export {
  __resetHeartbeatEmitterForTests,
  setHeartbeatEmitter,
} from '@modules/schedules/service/heartbeat-emitter'

const schedules: ModuleDef = {
  name: 'schedules',
  requires: ['agents'],
  jobs: [...jobs],
  init(ctx) {
    installSchedulesService(createSchedulesService({ db: ctx.db }))
    void ctx.jobs.schedule?.(SCHEDULES_TICK_JOB, SCHEDULES_TICK_CRON, undefined, {
      singletonKey: SCHEDULES_TICK_JOB,
    })
    ctx.cli.registerAll(schedulesVerbs)
  },
}

export default schedules

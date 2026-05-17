/**
 * `automations` module — owns `automation_rules` + `automations` + `automation_runs`
 * + `tenant_budget_caps`, the typed event bus, the cron-tick driver, and the
 * dispatcher.
 *
 * Depends on `agents` so the automations service can reference agent ids; the
 * cron-tick handler delegates heartbeat emission to a hook the agents module
 * provides at boot via `setHeartbeatEmitter` (re-exported here for ergonomic
 * downstream import). Without an emitter installed the tick runs but emits
 * nothing — useful for tests that exercise schedule mutation only.
 *
 * US-013 (Slice D.1): at boot we install `BudgetCapsService`, the budget
 * watcher's DB handle, and the `dispatcher` callback into `events.setDispatcher`
 * — wiring the event bus to actually drive wakes.
 */

import {
  AUTOMATIONS_RUNS_PRUNE_CRON,
  AUTOMATIONS_RUNS_PRUNE_JOB,
  AUTOMATIONS_TICK_CRON,
  AUTOMATIONS_TICK_JOB,
  jobs,
} from '@modules/automations/jobs'
import { installAdminAlertDeps } from '@modules/automations/service/admin-alert'
import { createAutomationsService, installAutomationsService } from '@modules/automations/service/automations'
import { createBudgetCapsService, installBudgetCapsService } from '@modules/automations/service/budget-caps'
import { installBudgetWatcherDb } from '@modules/automations/service/budget-watcher'
import { dispatchEvent, installDispatcher } from '@modules/automations/service/dispatcher'
import { setDispatcher } from '@modules/automations/service/events'
import { installRunsPruneDb } from '@modules/automations/service/runs-prune-job'

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
    installAutomationsService(createAutomationsService({ db: ctx.db, realtime: ctx.realtime }))
    installBudgetCapsService(createBudgetCapsService({ db: ctx.db, realtime: ctx.realtime }))
    installBudgetWatcherDb(ctx.db)
    installDispatcher({ db: ctx.db, jobs: ctx.jobs, realtime: ctx.realtime })
    installAdminAlertDeps({ db: ctx.db })
    installRunsPruneDb(ctx.db)
    // Adapt to the void-returning DispatcherFn — emit() doesn't care about the
    // per-rule DispatchResult[] return shape.
    setDispatcher(async (name, payload, eventCtx) => {
      await dispatchEvent(name, payload, eventCtx)
    })
    void ctx.jobs.schedule?.(AUTOMATIONS_TICK_JOB, AUTOMATIONS_TICK_CRON, undefined, {
      singletonKey: AUTOMATIONS_TICK_JOB,
    })
    // US-015: nightly automation_runs prune at 03:00 UTC.
    void ctx.jobs.schedule?.(AUTOMATIONS_RUNS_PRUNE_JOB, AUTOMATIONS_RUNS_PRUNE_CRON, undefined, {
      singletonKey: AUTOMATIONS_RUNS_PRUNE_JOB,
    })
    ctx.cli.registerAll(automationsVerbs)
  },
}

export default automations

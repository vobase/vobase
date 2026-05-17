/**
 * Heartbeat wake handler — receives `HeartbeatTrigger` events from the
 * automations cron-tick worker and drives a standalone-lane wake.
 *
 * This file is the body of the `setHeartbeatEmitter` callback. The agents
 * module wires it at boot. Without it installed, the automations cron-tick
 * runs but emits nothing (the documented no-op).
 *
 * Also the sole producer for the `cron` event in the typed event bus
 * (`scripts/check-emit.config.ts::EMIT_REGISTRY.cron`). The `emit('cron', ...)`
 * call lives inside a `db.transaction(...)` callback so the emit row lands
 * in the same Postgres tx as the wake — rollback ⇒ no event leak.
 */

import { getById as getAgentDefinition } from '@modules/agents/service/agent-definitions'
import type { HeartbeatTrigger } from '@modules/automations/jobs'
import { emit } from '@modules/automations/service/events'
import type { AgentContributions, HarnessLogger, ScopedScheduler } from '@vobase/core'
import { createHarness } from '@vobase/core'

import type { RealtimeService, ScopedDb, Tx } from '~/runtime'
import type { WakeContext } from './context'
import type { WakeTrigger } from './events'
import { standaloneWakeConfig } from './standalone'

export interface HeartbeatHandlerDeps {
  realtime: RealtimeService
  db: ScopedDb
  logger: HarnessLogger
  jobs: ScopedScheduler
}

/**
 * Build the heartbeat emitter callback. Installed once at agents-module init
 * via `setHeartbeatEmitter()`. The cron-tick driver invokes it per-row with
 * the trigger payload; each invocation is one standalone-lane wake.
 *
 * Errors are swallowed and logged — a single failing schedule must not
 * starve siblings (the cron-tick worker iterates rows sequentially and
 * already isolates exceptions, but defensive logging here makes the trail
 * grep-friendly).
 */
export function createHeartbeatEmitter(deps: HeartbeatHandlerDeps, contributions: AgentContributions<WakeContext>) {
  // Per-tick `db.transaction` ensures `emit('cron', ...)` lands in the same
  // Postgres tx as the wake build — rollback ⇒ no orphan event row, and the
  // wake-pipeline emit (createHarness) stays inside the tx scope alongside it.
  const txDb = deps.db as unknown as {
    transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  }
  return async function emitHeartbeat(trigger: HeartbeatTrigger): Promise<void> {
    console.log('[heartbeat] firing', {
      schedule: trigger.scheduleId,
      agent: trigger.agentId,
      at: trigger.intendedRunAt,
    })
    try {
      const agentDefinition = await getAgentDefinition(trigger.agentId)
      await txDb.transaction(async (tx) => {
        await emit('cron', { scheduleId: trigger.scheduleId, intendedRunAt: trigger.intendedRunAt }, { tx })
        const config = await standaloneWakeConfig({
          data: {
            organizationId: trigger.organizationId,
            triggerKind: 'heartbeat',
            scheduleId: trigger.scheduleId,
            intendedRunAt: new Date(trigger.intendedRunAt),
            reason: `cron ${trigger.cron}`,
          },
          agentId: trigger.agentId,
          agentDefinition,
          contributions,
          deps,
        })
        await createHarness<WakeTrigger>(config)
      })
    } catch (err) {
      console.error('[heartbeat] createHarness failed:', err)
    }
  }
}

/**
 * Heartbeat wake handler — receives `HeartbeatTrigger` events from the
 * schedules cron-tick worker and drives a standalone-lane wake.
 *
 * This file is the body of the `setHeartbeatEmitter` callback. The agents
 * module wires it at boot. Without it installed, the schedules cron-tick
 * runs but emits nothing (the documented no-op).
 */

import type { WakeTrigger } from '@modules/agents/events'
import { getById as getAgentDefinition } from '@modules/agents/service/agent-definitions'
import type { HeartbeatTrigger } from '@modules/schedules/jobs'
import type { AgentContributions, HarnessLogger } from '@vobase/core'
import { createHarness } from '@vobase/core'

import type { RealtimeService, ScopedDb } from '~/runtime'
import { buildStandaloneWakeConfig } from './build-config/standalone'

export interface HeartbeatHandlerDeps {
  realtime: RealtimeService
  db: ScopedDb
  logger: HarnessLogger
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
export function createHeartbeatEmitter(deps: HeartbeatHandlerDeps, contributions: AgentContributions) {
  return async function emitHeartbeat(trigger: HeartbeatTrigger): Promise<void> {
    console.log('[heartbeat] firing', {
      schedule: trigger.scheduleId,
      agent: trigger.agentId,
      at: trigger.intendedRunAt,
    })
    try {
      const agentDefinition = await getAgentDefinition(trigger.agentId)
      const config = await buildStandaloneWakeConfig({
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
    } catch (err) {
      console.error('[heartbeat] createHarness failed:', err)
    }
  }
}

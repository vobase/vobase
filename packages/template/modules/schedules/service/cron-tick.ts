/**
 * Cron-tick driver — runs once per `schedules:cron-tick` invocation, walks
 * every enabled schedule, and emits a `heartbeat` trigger per ready row.
 *
 * Two pieces of safety:
 *   1. **Idempotency.** Each schedule's idempotency key is
 *      `(scheduleId, intendedRunAt)`. `recordTick` returns `firstFire: true`
 *      only on the first writer, so a duplicate tick across workers is a
 *      no-op.
 *   2. **Failure isolation.** A single schedule's emitter throwing must not
 *      starve siblings — errors go to the logger and the loop continues.
 */

import type { HeartbeatTrigger } from '@modules/schedules/jobs'
import { schedules } from '@modules/schedules/service/schedules'

export interface CronTickDeps {
  emitHeartbeat: (trigger: HeartbeatTrigger) => Promise<void>
  /** Override clock — tests pin to a deterministic now. */
  now?: () => Date
  log?: (msg: string, meta?: Record<string, unknown>) => void
}

export interface CronTickResult {
  /** Number of schedules that emitted a heartbeat this tick. */
  fired: number
  /** Number of schedules that were ready but de-duped to a previous tick. */
  duplicates: number
  /** Schedules whose emit threw. */
  errors: number
}

/**
 * Drive one round of the cron sweeper. Caller invokes per pg-boss tick (or
 * per minute in dev). Pulls every enabled schedule globally in one query so
 * the cron job doesn't need an org list — heartbeats from all tenants ride
 * the same tick.
 */
export async function tickSchedules(deps: CronTickDeps): Promise<CronTickResult> {
  const now = (deps.now ?? (() => new Date()))()
  const intendedRunAt = roundDownToMinute(now)
  const result: CronTickResult = { fired: 0, duplicates: 0, errors: 0 }

  const enabled = await schedules.listAllEnabled()
  for (const row of enabled) {
    try {
      const tick = await schedules.recordTick({ scheduleId: row.id, intendedRunAt })
      if (!tick.firstFire) {
        result.duplicates += 1
        continue
      }
      await deps.emitHeartbeat({
        kind: 'heartbeat',
        scheduleId: row.id,
        agentId: row.agentId,
        organizationId: row.organizationId,
        intendedRunAt: intendedRunAt.toISOString(),
        cron: row.cron,
      })
      result.fired += 1
    } catch (err) {
      deps.log?.('schedules.tick: emit failed', { scheduleId: row.id, err: String(err) })
      result.errors += 1
    }
  }
  return result
}

function roundDownToMinute(d: Date): Date {
  const out = new Date(d)
  out.setUTCSeconds(0, 0)
  return out
}

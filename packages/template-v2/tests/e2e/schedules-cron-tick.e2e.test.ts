/**
 * `schedules:cron-tick` driver — real-Postgres e2e proving idempotency under
 * concurrency, monotonic tick advancement, and per-schedule failure isolation
 * in the sweeper loop.
 *
 * The unit test next to `cron-tick.ts` uses a stub DB; this file exercises the
 * actual SQL `WHERE last_tick_at IS NULL OR last_tick_at < intendedRunAt`
 * predicate against PG to catch cases the stub can't (race ordering, NULL
 * semantics, time-zone-aware timestamp comparison).
 *
 * Driven through the public service surface:
 *   - `createSchedulesService({ db })` + `installSchedulesService(svc)`
 *     install the singleton that `tickSchedules` consults.
 *   - `tickSchedules` is called per-test against a global `listAllEnabled` query
 *     and a synchronous `emitHeartbeat` spy so we can assert exactly which
 *     schedules fired.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { MERIDIAN_AGENT_ID, MERIDIAN_ORG_ID } from '@modules/agents/seed'
import type { HeartbeatTrigger } from '@modules/schedules/jobs'
import { agentSchedules } from '@modules/schedules/schema'
import { tickSchedules } from '@modules/schedules/service/cron-tick'
import {
  __resetSchedulesServiceForTests,
  createSchedulesService,
  installSchedulesService,
  schedules,
} from '@modules/schedules/service/schedules'
import { and, eq } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

let db: TestDbHandle

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  installSchedulesService(createSchedulesService({ db: db.db }))
}, 60_000)

afterAll(async () => {
  __resetSchedulesServiceForTests()
  if (db) await db.teardown()
})

afterEach(async () => {
  // Each test owns its schedules — wipe between tests for isolation.
  await db.db.delete(agentSchedules).where(eq(agentSchedules.organizationId, MERIDIAN_ORG_ID))
})

function makeSchedule(slug: string, cron = '0 * * * *'): Promise<{ scheduleId: string }> {
  return schedules.create({ organizationId: MERIDIAN_ORG_ID, agentId: MERIDIAN_AGENT_ID, slug, cron })
}

const T0 = new Date('2026-04-26T10:00:00.000Z')
const T1 = new Date('2026-04-26T10:01:00.000Z')

describe('schedules cron-tick (real PG)', () => {
  it('first recordTick returns firstFire=true; same-key replay returns false', async () => {
    const { scheduleId } = await makeSchedule('first-fire-replay')

    const a = await schedules.recordTick({ scheduleId, intendedRunAt: T0 })
    const b = await schedules.recordTick({ scheduleId, intendedRunAt: T0 })

    expect(a.firstFire).toBe(true)
    expect(b.firstFire).toBe(false)
    expect(a.idempotencyKey).toBe(b.idempotencyKey)
  })

  it('races: two concurrent recordTicks with identical key produce exactly one firstFire=true', async () => {
    const { scheduleId } = await makeSchedule('race')

    const [r1, r2] = await Promise.all([
      schedules.recordTick({ scheduleId, intendedRunAt: T0 }),
      schedules.recordTick({ scheduleId, intendedRunAt: T0 }),
    ])

    const fires = [r1, r2].filter((r) => r.firstFire)
    expect(fires).toHaveLength(1)
  })

  it('a later intendedRunAt advances lastTickAt; an earlier one does not', async () => {
    const { scheduleId } = await makeSchedule('monotonic')

    const first = await schedules.recordTick({ scheduleId, intendedRunAt: T0 })
    const ahead = await schedules.recordTick({ scheduleId, intendedRunAt: T1 })
    const behind = await schedules.recordTick({ scheduleId, intendedRunAt: T0 })

    expect(first.firstFire).toBe(true)
    expect(ahead.firstFire).toBe(true)
    expect(behind.firstFire).toBe(false)

    const [row] = await db.db
      .select({ lastTickAt: agentSchedules.lastTickAt })
      .from(agentSchedules)
      .where(eq(agentSchedules.id, scheduleId))
    expect(row?.lastTickAt?.toISOString()).toBe(T1.toISOString())
  })

  it('disabled schedules are skipped by listEnabled and never receive a tick from the sweeper', async () => {
    const a = await makeSchedule('enabled')
    const b = await makeSchedule('disabled')
    await schedules.setEnabled({ scheduleId: b.scheduleId, enabled: false })

    const enabled = await schedules.listEnabled({ organizationId: MERIDIAN_ORG_ID })
    expect(enabled.map((r) => r.id).sort()).toEqual([a.scheduleId].sort())

    const fired: HeartbeatTrigger[] = []
    const result = await tickSchedules({
      now: () => T0,
      emitHeartbeat: (t) => {
        fired.push(t)
        return Promise.resolve()
      },
    })

    expect(result.fired).toBe(1)
    expect(result.duplicates).toBe(0)
    expect(fired.map((t) => t.scheduleId)).toEqual([a.scheduleId])
  })

  it('tickSchedules: second sweep at the same minute dedupes every schedule', async () => {
    const a = await makeSchedule('a')
    const b = await makeSchedule('b')

    const fired1: HeartbeatTrigger[] = []
    const fired2: HeartbeatTrigger[] = []
    const opts = (sink: HeartbeatTrigger[]) => ({
      now: () => T0,
      emitHeartbeat: (t: HeartbeatTrigger) => {
        sink.push(t)
        return Promise.resolve()
      },
    })

    const r1 = await tickSchedules(opts(fired1))
    const r2 = await tickSchedules(opts(fired2))

    expect(r1.fired).toBe(2)
    expect(r1.duplicates).toBe(0)
    expect(r2.fired).toBe(0)
    expect(r2.duplicates).toBe(2)
    expect(fired1.map((t) => t.scheduleId).sort()).toEqual([a.scheduleId, b.scheduleId].sort())
    expect(fired2).toHaveLength(0)
  })

  it('emitter throw on one schedule does not starve siblings (failure isolation)', async () => {
    const a = await makeSchedule('a')
    const b = await makeSchedule('b')

    const fired: HeartbeatTrigger[] = []
    const result = await tickSchedules({
      now: () => T0,
      emitHeartbeat: (t) => {
        if (t.scheduleId === a.scheduleId) return Promise.reject(new Error('boom'))
        fired.push(t)
        return Promise.resolve()
      },
    })

    expect(result.errors).toBe(1)
    expect(result.fired).toBe(1)
    expect(fired.map((t) => t.scheduleId)).toEqual([b.scheduleId])
  })

  it('global sweep: enabled schedules from every org fire on the same tick', async () => {
    await makeSchedule('mine')
    const otherOrg = 'org0other00'
    await db.db.insert(agentSchedules).values({
      organizationId: otherOrg,
      agentId: MERIDIAN_AGENT_ID,
      slug: 'theirs',
      cron: '0 * * * *',
      timezone: 'UTC',
      enabled: true,
    })

    const fired: HeartbeatTrigger[] = []
    await tickSchedules({
      now: () => T0,
      emitHeartbeat: (t) => {
        fired.push(t)
        return Promise.resolve()
      },
    })

    expect(fired.map((t) => t.organizationId).sort()).toEqual([MERIDIAN_ORG_ID, otherOrg].sort())

    await db.db
      .delete(agentSchedules)
      .where(and(eq(agentSchedules.organizationId, otherOrg), eq(agentSchedules.slug, 'theirs')))
  })
})

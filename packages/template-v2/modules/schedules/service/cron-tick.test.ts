import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { HeartbeatTrigger } from '@modules/schedules/jobs'
import { tickSchedules } from '@modules/schedules/service/cron-tick'
import {
  __resetSchedulesServiceForTests,
  createSchedulesService,
  installSchedulesService,
  schedules,
} from '@modules/schedules/service/schedules'
import { sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb } from '~/tests/helpers/test-db'

let handle: ReturnType<typeof connectTestDb>
let db: ReturnType<typeof connectTestDb>['db']
const ORG = 'org-1'
const AGENT = 'agent-cron-tick'

beforeAll(async () => {
  await resetAndSeedDb()
  handle = connectTestDb()
  db = handle.db
})

beforeEach(async () => {
  __resetSchedulesServiceForTests()
  await db.execute(sql`TRUNCATE schedules.agent_schedules CASCADE`)
  // CASCADE is a no-op for these tables today, but keeps test ordering safe if
  // future FKs land on the row.
  await db.execute(
    sql`INSERT INTO agents.agent_definitions (id, organization_id, name, role) VALUES (${AGENT}, ${ORG}, 'cron-tick agent', 'operator') ON CONFLICT (id) DO UPDATE SET role = 'operator'`,
  )
  installSchedulesService(
    createSchedulesService({
      db: db as unknown as Parameters<typeof createSchedulesService>[0]['db'],
    }),
  )
})

afterEach(() => {
  __resetSchedulesServiceForTests()
})

describe('schedules cron-tick', () => {
  it('emits one heartbeat per enabled schedule on the first tick', async () => {
    await schedules.create({ organizationId: ORG, agentId: AGENT, slug: 'daily', cron: '*/5 * * * *' })
    const fired: HeartbeatTrigger[] = []
    const result = await tickSchedules({
      now: () => new Date('2026-04-26T12:00:30Z'),
      emitHeartbeat: async (t) => {
        fired.push(t)
      },
    })
    expect(result).toEqual({ fired: 1, duplicates: 0, errors: 0 })
    expect(fired.length).toBe(1)
    expect(fired[0]?.kind).toBe('heartbeat')
    expect(fired[0]?.agentId).toBe(AGENT)
    // Boundary rounded down to the minute.
    expect(fired[0]?.intendedRunAt).toBe('2026-04-26T12:00:00.000Z')
  })

  it('de-dupes identical ticks at the same minute boundary', async () => {
    await schedules.create({ organizationId: ORG, agentId: AGENT, slug: 'daily', cron: '* * * * *' })
    const now = () => new Date('2026-04-26T12:00:42Z')
    const a = await tickSchedules({ now, emitHeartbeat: async () => {} })
    const b = await tickSchedules({ now, emitHeartbeat: async () => {} })
    expect(a).toEqual({ fired: 1, duplicates: 0, errors: 0 })
    expect(b).toEqual({ fired: 0, duplicates: 1, errors: 0 })
  })

  it('skips disabled schedules and processes the next boundary forward', async () => {
    const a = await schedules.create({ organizationId: ORG, agentId: AGENT, slug: 'a', cron: '* * * * *' })
    await schedules.create({ organizationId: ORG, agentId: AGENT, slug: 'b', cron: '* * * * *' })
    await schedules.setEnabled({ scheduleId: a.scheduleId, enabled: false })
    const fired: HeartbeatTrigger[] = []
    const r1 = await tickSchedules({
      now: () => new Date('2026-04-26T12:01:00Z'),
      emitHeartbeat: async (t) => {
        fired.push(t)
      },
    })
    expect(r1.fired).toBe(1)
    expect(fired[0]?.scheduleId).toBeDefined()
    // Advancing the clock to the next minute fires again — boundary moved.
    const r2 = await tickSchedules({
      now: () => new Date('2026-04-26T12:02:05Z'),
      emitHeartbeat: async () => {},
    })
    expect(r2.fired).toBe(1)
    expect(r2.duplicates).toBe(0)
  })

  it('isolates emitter failures per schedule', async () => {
    await schedules.create({ organizationId: ORG, agentId: AGENT, slug: 'good', cron: '* * * * *' })
    await schedules.create({ organizationId: ORG, agentId: AGENT, slug: 'bad', cron: '* * * * *' })
    let goodFires = 0
    const result = await tickSchedules({
      now: () => new Date('2026-04-26T13:00:00Z'),
      emitHeartbeat: async (t) => {
        if (t.cron === '* * * * *' && (t as HeartbeatTrigger).scheduleId.includes('z-never-matches')) {
          // unreachable; placeholder to ensure shape compiles
        }
        // Throw on the first fire only — siblings continue.
        if (goodFires === 0) {
          goodFires += 1
          throw new Error('emit boom')
        }
      },
    })
    expect(result.fired + result.errors).toBe(2)
    expect(result.errors).toBe(1)
  })
})

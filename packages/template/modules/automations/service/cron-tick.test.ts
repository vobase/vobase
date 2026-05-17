import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { HeartbeatTrigger } from '@modules/automations/jobs'
import {
  __resetAutomationsServiceForTests,
  automationsService,
  createAutomationsService,
  installAutomationsService,
} from '@modules/automations/service/automations'
import { tickCron } from '@modules/automations/service/cron-tick'
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
  __resetAutomationsServiceForTests()
  await db.execute(sql`TRUNCATE automations.automation_rules CASCADE`)
  // CASCADE is a no-op for these tables today, but keeps test ordering safe if
  // future FKs land on the row.
  await db.execute(
    sql`INSERT INTO agents.agent_definitions (id, organization_id, name) VALUES (${AGENT}, ${ORG}, 'cron-tick agent') ON CONFLICT (id) DO NOTHING`,
  )
  installAutomationsService(
    createAutomationsService({
      db: db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
    }),
  )
})

afterEach(() => {
  __resetAutomationsServiceForTests()
})

describe('automations cron-tick', () => {
  it('emits one heartbeat per enabled schedule on the first tick', async () => {
    await automationsService.create({ organizationId: ORG, agentId: AGENT, slug: 'daily', cron: '*/5 * * * *' })
    const fired: HeartbeatTrigger[] = []
    const result = await tickCron({
      now: () => new Date('2026-04-26T12:00:30Z'),
      // biome-ignore lint/suspicious/useAwait: emitter contract requires async signature
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
    await automationsService.create({ organizationId: ORG, agentId: AGENT, slug: 'daily', cron: '* * * * *' })
    const now = () => new Date('2026-04-26T12:00:42Z')
    const a = await tickCron({ now, emitHeartbeat: async () => {} })
    const b = await tickCron({ now, emitHeartbeat: async () => {} })
    expect(a).toEqual({ fired: 1, duplicates: 0, errors: 0 })
    expect(b).toEqual({ fired: 0, duplicates: 1, errors: 0 })
  })

  it('skips disabled schedules and processes the next boundary forward', async () => {
    const a = await automationsService.create({ organizationId: ORG, agentId: AGENT, slug: 'a', cron: '* * * * *' })
    await automationsService.create({ organizationId: ORG, agentId: AGENT, slug: 'b', cron: '* * * * *' })
    await automationsService.setEnabled({ scheduleId: a.scheduleId, enabled: false })
    const fired: HeartbeatTrigger[] = []
    const r1 = await tickCron({
      now: () => new Date('2026-04-26T12:01:00Z'),
      // biome-ignore lint/suspicious/useAwait: emitter contract requires async signature
      emitHeartbeat: async (t) => {
        fired.push(t)
      },
    })
    expect(r1.fired).toBe(1)
    expect(fired[0]?.scheduleId).toBeDefined()
    // Advancing the clock to the next minute fires again — boundary moved.
    const r2 = await tickCron({
      now: () => new Date('2026-04-26T12:02:05Z'),
      emitHeartbeat: async () => {},
    })
    expect(r2.fired).toBe(1)
    expect(r2.duplicates).toBe(0)
  })

  it('isolates emitter failures per schedule', async () => {
    await automationsService.create({ organizationId: ORG, agentId: AGENT, slug: 'good', cron: '* * * * *' })
    await automationsService.create({ organizationId: ORG, agentId: AGENT, slug: 'bad', cron: '* * * * *' })
    let goodFires = 0
    const result = await tickCron({
      now: () => new Date('2026-04-26T13:00:00Z'),
      // biome-ignore lint/suspicious/useAwait: emitter contract requires async signature
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

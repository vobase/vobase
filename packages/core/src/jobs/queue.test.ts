import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { PGlite } from '@electric-sql/pglite'

import { createTestPGlite } from '../test-helpers'
import { createScheduler, type Scheduler } from './queue'

let pglite: PGlite
let scheduler: Scheduler

beforeAll(async () => {
  pglite = await createTestPGlite()
  scheduler = await createScheduler({ connection: pglite })
})

afterAll(async () => {
  await scheduler.stop()
})

describe('createScheduler()', () => {
  it('enqueues a job via scheduler.add()', async () => {
    await scheduler.add('email.send', { to: 'user@example.com' })

    const result = await pglite.query<{ name: string }>("SELECT name FROM pgboss.job WHERE name = 'email.send' LIMIT 1")
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('email.send')
  })

  it('send() returns a job ID string', async () => {
    const id = await scheduler.send('invoice.generate', { number: 'INV-001' })

    expect(typeof id).toBe('string')
    expect(id).toBeTruthy()
  })

  it('send() with retryLimit stores job with correct name', async () => {
    await scheduler.add('report.build', { period: 'weekly' }, { retryLimit: 3 })

    const result = await pglite.query<{ name: string }>(
      "SELECT name FROM pgboss.job WHERE name = 'report.build' LIMIT 1",
    )
    expect(result.rows).toHaveLength(1)
  })
})

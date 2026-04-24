/**
 * Smoke: active_wakes lease primitives against PGlite.
 *
 * Exercises the ON CONFLICT DO UPDATE WHERE clause in acquire() — the stale
 * lease reclaim path cannot be validated without a real planner, since the
 * predicate is evaluated server-side as part of the conflict resolution.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'

import type { VobaseDb } from '../../src/db/client'
import { acquire, getWorker, release, sweepStale } from '../../src/harness/wake-registry'
import { activeWakes } from '../../src/schemas/harness'
import { freshDb } from '../helpers/pglite'

let db: VobaseDb

beforeAll(async () => {
  const { db: d } = await freshDb()
  db = d
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "harness"."active_wakes" (
      conversation_id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      debounce_until TIMESTAMPTZ NOT NULL
    )
  `)
})

beforeEach(async () => {
  await db.delete(activeWakes)
})

describe('wake-registry (smoke)', () => {
  it('acquire() on an empty row returns true and creates the lease', async () => {
    const got = await acquire(db, 'conv_1', 'worker_A', 5_000)
    expect(got).toBe(true)
    expect(await getWorker(db, 'conv_1')).toBe('worker_A')
  })

  it('second acquire() by a different worker on a live lease returns false', async () => {
    await acquire(db, 'conv_2', 'worker_A', 5_000)
    const got = await acquire(db, 'conv_2', 'worker_B', 5_000)
    expect(got).toBe(false)
    expect(await getWorker(db, 'conv_2')).toBe('worker_A')
  })

  it('acquire() reclaims a stale lease (debounce_until in the past)', async () => {
    await acquire(db, 'conv_3', 'worker_A', 5_000)
    await db
      .update(activeWakes)
      .set({ debounceUntil: sql`now() - interval '10 seconds'` })
      .where(sql`${activeWakes.conversationId} = ${'conv_3'}`)

    const got = await acquire(db, 'conv_3', 'worker_B', 5_000)
    expect(got).toBe(true)
    expect(await getWorker(db, 'conv_3')).toBe('worker_B')
  })

  it('release() only removes the lease when worker matches', async () => {
    await acquire(db, 'conv_4', 'worker_A', 5_000)
    await release(db, 'conv_4', 'worker_B')
    expect(await getWorker(db, 'conv_4')).toBe('worker_A')
    await release(db, 'conv_4', 'worker_A')
    expect(await getWorker(db, 'conv_4')).toBeNull()
  })

  it('getWorker() returns null for expired leases without deleting them', async () => {
    await acquire(db, 'conv_5', 'worker_A', 5_000)
    await db
      .update(activeWakes)
      .set({ debounceUntil: sql`now() - interval '1 second'` })
      .where(sql`${activeWakes.conversationId} = ${'conv_5'}`)

    expect(await getWorker(db, 'conv_5')).toBeNull()

    const rows = await db.select().from(activeWakes)
    expect(rows).toHaveLength(1)
  })

  it('sweepStale() deletes leases older than one minute and reports the count', async () => {
    await acquire(db, 'conv_fresh', 'worker_A', 60_000)
    await acquire(db, 'conv_stale_1', 'worker_B', 5_000)
    await acquire(db, 'conv_stale_2', 'worker_C', 5_000)
    await db
      .update(activeWakes)
      .set({ debounceUntil: sql`now() - interval '2 minutes'` })
      .where(sql`${activeWakes.conversationId} IN (${'conv_stale_1'}, ${'conv_stale_2'})`)

    const swept = await sweepStale(db)
    expect(swept).toBe(2)

    const remaining = await db.select({ id: activeWakes.conversationId }).from(activeWakes)
    expect(remaining.map((r) => r.id)).toEqual(['conv_fresh'])
  })

  it('acquire() is idempotent for the same worker holding a live lease', async () => {
    await acquire(db, 'conv_6', 'worker_A', 5_000)
    const got = await acquire(db, 'conv_6', 'worker_A', 5_000)
    // Conflict with same worker: WHERE debounce_until < now() is false (lease
    // is live), so no row is updated and no row is returned.
    expect(got).toBe(false)
    expect(await getWorker(db, 'conv_6')).toBe('worker_A')
  })
})

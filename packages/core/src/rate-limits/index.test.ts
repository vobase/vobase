import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'

import type { VobaseDb } from '../db/client'
import { createTestPGlite } from '../test-helpers'
import { createRateLimiter } from '.'

let db: VobaseDb
let pglite: PGlite

beforeAll(async () => {
  pglite = await createTestPGlite()
  await pglite.exec(`
    CREATE TABLE "infra"."rate_limits" (
      key TEXT NOT NULL,
      hit_at TIMESTAMPTZ NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (key, hit_at, seq)
    );
    CREATE INDEX rate_limits_key_hit_at_idx ON "infra"."rate_limits" (key, hit_at);
  `)
  db = drizzle({ client: pglite })
})

beforeEach(async () => {
  await pglite.query('DELETE FROM "infra"."rate_limits"')
})

describe('createRateLimiter', () => {
  test('allows up to limit hits inside the window', async () => {
    const limiter = createRateLimiter(db)
    const r1 = await limiter.acquire('user:42', 3, 60)
    const r2 = await limiter.acquire('user:42', 3, 60)
    const r3 = await limiter.acquire('user:42', 3, 60)
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r3.ok).toBe(true)
    expect(r1.retryAfter).toBeNull()
    expect(r3.retryAfter).toBeNull()
  })

  test('rejects after limit, returns retryAfter', async () => {
    const limiter = createRateLimiter(db)
    await limiter.acquire('user:99', 2, 60)
    await limiter.acquire('user:99', 2, 60)
    const denied = await limiter.acquire('user:99', 2, 60)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfter).toBeInstanceOf(Date)
    if (denied.retryAfter) {
      expect(denied.retryAfter.getTime()).toBeGreaterThan(Date.now())
    }
  })

  test('separate keys do not share the bucket', async () => {
    const limiter = createRateLimiter(db)
    await limiter.acquire('a', 1, 60)
    const otherKey = await limiter.acquire('b', 1, 60)
    const sameKey = await limiter.acquire('a', 1, 60)
    expect(otherKey.ok).toBe(true)
    expect(sameKey.ok).toBe(false)
  })

  test('window slides — old hits prune as the window advances', async () => {
    const limiter = createRateLimiter(db)
    await pglite.query(
      `INSERT INTO "infra"."rate_limits" (key, hit_at, seq) VALUES
        ('slide', now() - interval '5 seconds', 1),
        ('slide', now() - interval '4 seconds', 2),
        ('slide', now() - interval '3 seconds', 3)`,
    )
    const result = await limiter.acquire('slide', 3, 1)
    expect(result.ok).toBe(true)
  })

  test('uses Postgres now() so application clock skew is irrelevant', async () => {
    const limiter = createRateLimiter(db)
    await limiter.acquire('clock', 1, 60)
    const before = Date.now()
    const rows = await pglite.query<{ hit_at: string }>(`SELECT hit_at FROM "infra"."rate_limits" WHERE key = 'clock'`)
    expect(rows.rows.length).toBe(1)
    const t = new Date(rows.rows[0].hit_at).getTime()
    expect(Math.abs(t - before)).toBeLessThan(5_000)
  })

  test('survives a restart — state lives in pg, not the limiter handle', async () => {
    const first = createRateLimiter(db)
    await first.acquire('restart', 2, 60)
    await first.acquire('restart', 2, 60)
    const fresh = createRateLimiter(db)
    const denied = await fresh.acquire('restart', 2, 60)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfter).toBeInstanceOf(Date)
  })

  test('rejects invalid limit / window', () => {
    const limiter = createRateLimiter(db)
    expect(limiter.acquire('x', 0, 60)).rejects.toThrow(/positive integer/)
    expect(limiter.acquire('x', -1, 60)).rejects.toThrow(/positive integer/)
    expect(limiter.acquire('x', 1.5, 60)).rejects.toThrow(/positive integer/)
    expect(limiter.acquire('x', 1, 0)).rejects.toThrow(/> 0/)
    expect(limiter.acquire('x', 1, -5)).rejects.toThrow(/> 0/)
  })
})

/**
 * Unit tests for `shouldSuppress` (US-009 / Slice B.4).
 *
 * Pure-predicate behaviour — the dispatcher (US-013) owns the
 * `automation_runs(status='suppressed_cooldown')` write; this test only
 * asserts the predicate's return value against a stubbed query result. The
 * cross-kind independence guarantee and the followup-bypass-with-real-rows
 * path are covered end-to-end by `cooldown-multi-kind.integration.test.ts`.
 */

import { describe, expect, it } from 'bun:test'

import { COOLDOWN_WINDOW_MS, shouldSuppress } from './cooldown'

interface FakeRow {
  claimedAt: Date | null
  createdAt: Date
}

/**
 * Minimal DB stub that returns `rows` for any `select().from().where()` chain.
 * Mirrors the shape the predicate consumes — no drizzle execution involved.
 */
function makeDbStub(rows: FakeRow[]): { db: unknown } {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
    },
  }
}

const KEY = {
  staffUserId: 'usr-cd-1',
  conversationId: 'conv-cd-1',
  organizationId: 'org-cd-1',
  kind: 'mention' as const,
}

describe('shouldSuppress predicate', () => {
  it('returns false when no rows match the (staff, conv, kind) key', async () => {
    const { db } = makeDbStub([])
    expect(await shouldSuppress(KEY, { db })).toBe(false)
  })

  it('returns true when a live (unclaimed) row exists in the window', async () => {
    const { db } = makeDbStub([{ claimedAt: null, createdAt: new Date(Date.now() - 60_000) }])
    expect(await shouldSuppress(KEY, { db })).toBe(true)
  })

  it('returns true when a claimed-in-window row exists (default reason)', async () => {
    const { db } = makeDbStub([{ claimedAt: new Date(Date.now() - 30_000), createdAt: new Date(Date.now() - 60_000) }])
    expect(await shouldSuppress(KEY, { db })).toBe(true)
  })

  it("reason='followup' bypasses when a claimed prior exists in the window", async () => {
    const { db } = makeDbStub([{ claimedAt: new Date(Date.now() - 30_000), createdAt: new Date(Date.now() - 60_000) }])
    expect(await shouldSuppress({ ...KEY, reason: 'followup' }, { db })).toBe(false)
  })

  it("reason='followup' still respects cooldown when only an unclaimed prior exists", async () => {
    const { db } = makeDbStub([{ claimedAt: null, createdAt: new Date(Date.now() - 60_000) }])
    expect(await shouldSuppress({ ...KEY, reason: 'followup' }, { db })).toBe(true)
  })

  it('window constant matches the plan (§3) — 5 minutes', () => {
    expect(COOLDOWN_WINDOW_MS).toBe(5 * 60 * 1000)
  })
})

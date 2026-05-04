/**
 * Unit + integration tests for the signup-nonces service.
 *
 * Unit half: throw-proxy guard (no DB needed).
 * Integration half: real Docker Postgres assertions for mint/consume/replay/
 * expiry/session-mismatch. Skipped (not failed) when the DB is unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { signupNonces } from '@modules/channels/schema'
import {
  __resetSignupNoncesServiceForTests,
  consumeNonce,
  createSignupNoncesService,
  installSignupNoncesService,
  mintNonce,
} from '@modules/channels/service/signup-nonces'
import { eq, sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'

describe('signup-nonces throw-proxy guard', () => {
  beforeAll(() => {
    // Drop any residual install from another test file in the same worker.
    __resetSignupNoncesServiceForTests()
  })

  it('mintNonce throws before installSignupNoncesService', () => {
    // Throw is synchronous — `current()` runs before the async body's first await.
    expect(() => mintNonce({ organizationId: 'org-x', sessionId: 'sess-x' })).toThrow('service not installed')
  })

  it('consumeNonce throws before installSignupNoncesService', () => {
    expect(() => consumeNonce({ nonce: 'n-x', organizationId: 'org-x', sessionId: 'sess-x' })).toThrow(
      'service not installed',
    )
  })
})

describe('signup-nonces (real Postgres)', () => {
  let handle: TestDbHandle | null = null

  beforeAll(async () => {
    try {
      await resetAndSeedDb()
      handle = connectTestDb()
      installSignupNoncesService(createSignupNoncesService({ db: handle.db }))
    } catch (err) {
      console.warn(`[signup-nonces.test] skipping integration suite: ${(err as Error).message}`)
    }
  }, 60_000)

  afterAll(async () => {
    if (handle) await handle.teardown()
  })

  it('mintNonce stores a row with org/session binding and 5-min expiry', async () => {
    if (!handle) return
    const before = Date.now()
    const { nonce, expiresAt } = await mintNonce({ organizationId: 'org-1', sessionId: 'sess-A' })
    const after = Date.now()
    const ttlMs = expiresAt.getTime() - before
    expect(ttlMs).toBeGreaterThan(4 * 60_000)
    expect(ttlMs).toBeLessThanOrEqual(5 * 60_000 + (after - before))

    const rows = await handle.db.select().from(signupNonces).where(eq(signupNonces.nonce, nonce))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.organizationId).toBe('org-1')
    expect(rows[0]?.sessionId).toBe('sess-A')
  })

  it('consumeNonce returns true once and false on replay', async () => {
    if (!handle) return
    const { nonce } = await mintNonce({ organizationId: 'org-1', sessionId: 'sess-replay' })
    const first = await consumeNonce({ nonce, organizationId: 'org-1', sessionId: 'sess-replay' })
    expect(first).toBe(true)

    const second = await consumeNonce({ nonce, organizationId: 'org-1', sessionId: 'sess-replay' })
    expect(second).toBe(false)
  })

  it('consumeNonce returns false on session mismatch and leaves the row intact', async () => {
    if (!handle) return
    const { nonce } = await mintNonce({ organizationId: 'org-1', sessionId: 'sess-A' })
    const wrongSession = await consumeNonce({ nonce, organizationId: 'org-1', sessionId: 'sess-B' })
    expect(wrongSession).toBe(false)

    // The row must still be present — a mismatch shouldn't burn the nonce.
    const rows = await handle.db.select().from(signupNonces).where(eq(signupNonces.nonce, nonce))
    expect(rows).toHaveLength(1)

    // The legitimate session can still consume.
    const ok = await consumeNonce({ nonce, organizationId: 'org-1', sessionId: 'sess-A' })
    expect(ok).toBe(true)
  })

  it('consumeNonce returns false on org mismatch', async () => {
    if (!handle) return
    const { nonce } = await mintNonce({ organizationId: 'org-1', sessionId: 'sess-X' })
    const wrongOrg = await consumeNonce({ nonce, organizationId: 'org-2', sessionId: 'sess-X' })
    expect(wrongOrg).toBe(false)
  })

  it('consumeNonce rejects expired nonces', async () => {
    if (!handle) return
    const { nonce } = await mintNonce({ organizationId: 'org-1', sessionId: 'sess-exp' })
    await handle.db.execute(
      sql`UPDATE "channels"."signup_nonces" SET expires_at = now() - interval '1 minute' WHERE nonce = ${nonce}`,
    )
    const result = await consumeNonce({ nonce, organizationId: 'org-1', sessionId: 'sess-exp' })
    expect(result).toBe(false)
  })
})

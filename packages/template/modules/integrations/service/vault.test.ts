/**
 * Integration tests for `createIntegrationsVault`.
 *
 * Covers `storeSecret` (single-pair AND with-previous), `readSecret`
 * (presence + grace-window honoring), `hasSecret`, and `rotate`. Real
 * Postgres + real envelope encryption — skipped when Docker pg is unreachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { createIntegrationsVault } from './vault'

const TEST_ORG_ID = 'org-vault-test'
const ORIGINAL_BAS = process.env.BETTER_AUTH_SECRET

let dbHandle: TestDbHandle | null = null

beforeAll(async () => {
  try {
    await resetAndSeedDb()
    dbHandle = connectTestDb()
  } catch (err) {
    console.warn(`[vault.test] skipping: ${(err as Error).message}`)
    return
  }
  if (!process.env.BETTER_AUTH_SECRET) {
    process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-must-be-at-least-32-chars-long-pls'
  }
}, 60_000)

afterAll(async () => {
  if (dbHandle) await dbHandle.teardown()
  if (ORIGINAL_BAS === undefined) delete process.env.BETTER_AUTH_SECRET
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_BAS
})

beforeEach(async () => {
  if (!dbHandle) return
  await dbHandle.db.execute(sql`TRUNCATE TABLE "integrations"."secrets" CASCADE`)
})

describe('vault.storeSecret — current only (legacy single-arg form)', () => {
  it('persists current pair, no previous', async () => {
    if (!dbHandle) return
    const vault = createIntegrationsVault({ db: dbHandle.db, organizationId: TEST_ORG_ID })
    await vault.storeSecret('vobase-platform', {
      routineSecret: 'r-v1',
      rotationKey: 'k-v1',
      keyVersion: 1,
    })
    const got = await vault.readSecret('vobase-platform')
    expect(got).not.toBeNull()
    expect(got?.current.routineSecret).toBe('r-v1')
    expect(got?.current.rotationKey).toBe('k-v1')
    expect(got?.current.keyVersion).toBe(1)
    expect(got?.previous).toBeNull()
  })
})

describe('vault.storeSecret — with previous (mid-rotation handshake)', () => {
  it('persists current + previous pair', async () => {
    if (!dbHandle) return
    const vault = createIntegrationsVault({ db: dbHandle.db, organizationId: TEST_ORG_ID })
    const validUntil = new Date(Date.now() + 5 * 60_000)
    await vault.storeSecret('vobase-platform', {
      current: { routineSecret: 'r-v2', rotationKey: 'k-v2', keyVersion: 2 },
      previous: { routineSecret: 'r-v1', rotationKey: 'k-v1', keyVersion: 1, validUntil },
    })
    const got = await vault.readSecret('vobase-platform')
    expect(got?.current.routineSecret).toBe('r-v2')
    expect(got?.previous?.routineSecret).toBe('r-v1')
    expect(got?.previous?.rotationKey).toBe('k-v1')
    expect(got?.previous?.keyVersion).toBe(1)
  })

  it('honors grace window — previous pair surfaces null after expiry', async () => {
    if (!dbHandle) return
    const vault = createIntegrationsVault({ db: dbHandle.db, organizationId: TEST_ORG_ID })
    const validUntil = new Date(Date.now() - 60_000) // already expired
    await vault.storeSecret('vobase-platform', {
      current: { routineSecret: 'r-v2', rotationKey: 'k-v2', keyVersion: 2 },
      previous: { routineSecret: 'r-v1', rotationKey: 'k-v1', keyVersion: 1, validUntil },
    })
    const got = await vault.readSecret('vobase-platform')
    expect(got?.previous).toBeNull()
  })

  it('overwrite without previous wipes any stale previous pair', async () => {
    if (!dbHandle) return
    const vault = createIntegrationsVault({ db: dbHandle.db, organizationId: TEST_ORG_ID })
    const validUntil = new Date(Date.now() + 5 * 60_000)
    await vault.storeSecret('vobase-platform', {
      current: { routineSecret: 'r-v2', rotationKey: 'k-v2', keyVersion: 2 },
      previous: { routineSecret: 'r-v1', rotationKey: 'k-v1', keyVersion: 1, validUntil },
    })
    // Re-handshake without previous — should clear stale previous.
    await vault.storeSecret('vobase-platform', {
      routineSecret: 'r-v3',
      rotationKey: 'k-v3',
      keyVersion: 3,
    })
    const got = await vault.readSecret('vobase-platform')
    expect(got?.current.routineSecret).toBe('r-v3')
    expect(got?.previous).toBeNull()
  })
})

describe('vault.hasSecret', () => {
  it('returns false then true', async () => {
    if (!dbHandle) return
    const vault = createIntegrationsVault({ db: dbHandle.db, organizationId: TEST_ORG_ID })
    expect(await vault.hasSecret('vobase-platform')).toBe(false)
    await vault.storeSecret('vobase-platform', {
      routineSecret: 'r',
      rotationKey: 'k',
      keyVersion: 1,
    })
    expect(await vault.hasSecret('vobase-platform')).toBe(true)
  })
})

describe('vault.rotate', () => {
  it('promotes current → previous, sets new current', async () => {
    if (!dbHandle) return
    const vault = createIntegrationsVault({ db: dbHandle.db, organizationId: TEST_ORG_ID })
    await vault.storeSecret('vobase-platform', {
      routineSecret: 'r-v1',
      rotationKey: 'k-v1',
      keyVersion: 1,
    })
    const validUntil = new Date(Date.now() + 5 * 60_000)
    await vault.rotate('vobase-platform', { routineSecret: 'r-v2', rotationKey: 'k-v2', keyVersion: 2 }, validUntil)
    const got = await vault.readSecret('vobase-platform')
    expect(got?.current.routineSecret).toBe('r-v2')
    expect(got?.previous?.routineSecret).toBe('r-v1')
    expect(got?.previous?.keyVersion).toBe(1)
  })

  it('rejects non-monotonic rotation', async () => {
    if (!dbHandle) return
    const vault = createIntegrationsVault({ db: dbHandle.db, organizationId: TEST_ORG_ID })
    await vault.storeSecret('vobase-platform', {
      routineSecret: 'r-v2',
      rotationKey: 'k-v2',
      keyVersion: 2,
    })
    await expect(
      vault.rotate(
        'vobase-platform',
        { routineSecret: 'r-v1', rotationKey: 'k-v1', keyVersion: 1 },
        new Date(Date.now() + 60_000),
      ),
    ).rejects.toThrow(/not greater than/)
  })
})

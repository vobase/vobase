import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { SEEDED_CONV_ID } from '../seed'
import { createSessionsService } from './sessions'

let db: TestDbHandle

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
}, 60_000)

afterAll(async () => {
  if (db) await db.teardown()
})

describe('createSessionsService', () => {
  it('checkWindow returns closed when no session exists', async () => {
    const svc = createSessionsService({ db: db.db })
    const result = await svc.checkWindow('nonexistent-conv-id')
    expect(result.open).toBe(false)
    expect(result.expiresAt).toBeNull()
  })

  it('seedOnInbound opens a window that checkWindow reports as open', async () => {
    const svc = createSessionsService({ db: db.db })
    await svc.seedOnInbound(SEEDED_CONV_ID, 'chi0cust00')
    const result = await svc.checkWindow(SEEDED_CONV_ID)
    expect(result.open).toBe(true)
    expect(result.expiresAt).not.toBeNull()
    // Window expires roughly 24h from now
    const expiresAt = result.expiresAt as Date
    const diffMs = expiresAt.getTime() - Date.now()
    expect(diffMs).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(diffMs).toBeLessThan(25 * 60 * 60 * 1000)
  })

  it('seedOnInbound is idempotent — second call refreshes the window', async () => {
    const svc = createSessionsService({ db: db.db })
    const t1 = new Date()
    await svc.seedOnInbound(SEEDED_CONV_ID, 'chi0cust00', t1)
    const t2 = new Date(t1.getTime() + 5_000)
    await svc.seedOnInbound(SEEDED_CONV_ID, 'chi0cust00', t2)
    const result = await svc.checkWindow(SEEDED_CONV_ID)
    // expiresAt should be based on t2, not t1
    expect(result.expiresAt?.getTime()).toBeGreaterThan(t1.getTime() + 24 * 60 * 60 * 1000)
  })

  it('closeWindow makes checkWindow report closed', async () => {
    const svc = createSessionsService({ db: db.db })
    await svc.seedOnInbound(SEEDED_CONV_ID, 'chi0cust00')
    await svc.closeWindow(SEEDED_CONV_ID)
    const result = await svc.checkWindow(SEEDED_CONV_ID)
    expect(result.open).toBe(false)
  })

  it('checkWindow reports closed when window has expired in the past', async () => {
    const svc = createSessionsService({ db: db.db })
    // Seed with a timestamp 25h in the past so window is already expired
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await svc.seedOnInbound(SEEDED_CONV_ID, 'chi0cust00', past)
    const result = await svc.checkWindow(SEEDED_CONV_ID)
    expect(result.open).toBe(false)
    expect(result.expiresAt).not.toBeNull()
  })
})

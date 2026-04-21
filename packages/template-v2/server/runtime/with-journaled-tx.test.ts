import { describe, expect, it, mock } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import type { ScopedDb, Tx } from '@server/contracts/plugin-context'
import { createWithJournaledTx, MissingJournalAppendError } from './with-journaled-tx'

/**
 * Minimal tx-shim: models drizzle's `db.transaction(fn)` so the sink logic is
 * exercisable without a real Postgres handle. Real-DB semantics are covered by
 * `e2e/wake-end-to-end.test.ts` once `inbox` migrates to `withJournaledTx` in
 * Step 6.
 */
function makeDb(): { db: ScopedDb; committed: boolean } {
  let committed = false
  const fakeTx = {} as Tx
  const db = {
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const result = await fn(fakeTx)
      committed = true
      return result
    },
  }
  return { db: db as unknown as ScopedDb, committed }
}

describe('createWithJournaledTx', () => {
  it('commits when fn calls journal.append at least once', async () => {
    const rawAppend = mock(async (_event: AgentEvent, _tx: Tx) => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx({ db, rawAppend })

    const result = await withJournaledTx(async (tx, journal) => {
      await journal.append({ kind: 'turn_end' } as unknown as AgentEvent, tx)
      return 42
    })

    expect(result).toBe(42)
    expect(rawAppend).toHaveBeenCalledTimes(1)
  })

  it('throws MissingJournalAppendError when fn never appends', async () => {
    const rawAppend = mock(async () => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx({ db, rawAppend })

    await expect(
      withJournaledTx(async () => {
        return 'forgot'
      }),
    ).rejects.toBeInstanceOf(MissingJournalAppendError)

    expect(rawAppend).not.toHaveBeenCalled()
  })

  it('allows multiple appends inside one tx', async () => {
    const rawAppend = mock(async () => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx({ db, rawAppend })

    await withJournaledTx(async (tx, journal) => {
      await journal.append({ kind: 'a' } as unknown as AgentEvent, tx)
      await journal.append({ kind: 'b' } as unknown as AgentEvent, tx)
    })

    expect(rawAppend).toHaveBeenCalledTimes(2)
  })

  it('propagates errors thrown inside fn (tx rolls back in real drizzle)', async () => {
    const rawAppend = mock(async () => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx({ db, rawAppend })

    await expect(
      withJournaledTx(async () => {
        throw new Error('domain failure')
      }),
    ).rejects.toThrow('domain failure')
  })

  it('forwards the tx handle passed by drizzle to journal.append', async () => {
    const rawAppend = mock(async () => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx({ db, rawAppend })

    let capturedTx: Tx | undefined
    await withJournaledTx(async (tx, journal) => {
      capturedTx = tx
      await journal.append({ kind: 'x' } as unknown as AgentEvent, tx)
    })

    expect(capturedTx).toBeDefined()
    expect(rawAppend).toHaveBeenCalledTimes(1)
  })
})

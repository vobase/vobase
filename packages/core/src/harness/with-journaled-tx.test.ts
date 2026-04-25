import { describe, expect, it, mock } from 'bun:test'

import { createWithJournaledTx, type JournaledTxDb, MissingJournalAppendError, type Tx } from './with-journaled-tx'

interface FakeEvent {
  kind: string
}

function makeDb(): { db: JournaledTxDb; committed: boolean } {
  let committed = false
  const fakeTx = {} as Tx
  const db: JournaledTxDb = {
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const result = await fn(fakeTx)
      committed = true
      return result
    },
  }
  return { db, committed }
}

describe('createWithJournaledTx', () => {
  it('commits when fn calls journal.append at least once', async () => {
    const rawAppend = mock(async (_event: FakeEvent, _tx: Tx) => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx<FakeEvent>({ db, rawAppend })

    const result = await withJournaledTx(async (tx, journal) => {
      await journal.append({ kind: 'turn_end' }, tx)
      return 42
    })

    expect(result).toBe(42)
    expect(rawAppend).toHaveBeenCalledTimes(1)
  })

  it('throws MissingJournalAppendError when fn never appends', async () => {
    const rawAppend = mock(async () => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx<FakeEvent>({ db, rawAppend })

    await expect(
      // biome-ignore lint/suspicious/useAwait: withJournaledTx fn contract requires async signature
      withJournaledTx(async () => {
        return 'forgot'
      }),
    ).rejects.toBeInstanceOf(MissingJournalAppendError)

    expect(rawAppend).not.toHaveBeenCalled()
  })

  it('allows multiple appends inside one tx', async () => {
    const rawAppend = mock(async () => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx<FakeEvent>({ db, rawAppend })

    await withJournaledTx(async (tx, journal) => {
      await journal.append({ kind: 'a' }, tx)
      await journal.append({ kind: 'b' }, tx)
    })

    expect(rawAppend).toHaveBeenCalledTimes(2)
  })

  it('propagates errors thrown inside fn (tx rolls back in real drizzle)', async () => {
    const rawAppend = mock(async () => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx<FakeEvent>({ db, rawAppend })

    await expect(
      // biome-ignore lint/suspicious/useAwait: withJournaledTx fn contract requires async signature
      withJournaledTx(async () => {
        throw new Error('domain failure')
      }),
    ).rejects.toThrow('domain failure')
  })

  it('forwards the tx handle passed by drizzle to journal.append', async () => {
    const rawAppend = mock(async () => {})
    const { db } = makeDb()
    const withJournaledTx = createWithJournaledTx<FakeEvent>({ db, rawAppend })

    let capturedTx: Tx | undefined
    await withJournaledTx(async (tx, journal) => {
      capturedTx = tx
      await journal.append({ kind: 'x' }, tx)
    })

    expect(capturedTx).toBeDefined()
    expect(rawAppend).toHaveBeenCalledTimes(1)
  })
})

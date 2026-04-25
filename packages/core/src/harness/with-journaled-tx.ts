/**
 * Transactional write path with mandatory journal append.
 *
 * Wraps a drizzle-shaped `db.transaction(fn)` with a `JournalSink` that
 * tracks whether `journal.append(event, tx)` was invoked inside the tx.
 * On commit, if the sink was never called, throws
 * `MissingJournalAppendError` — which causes the surrounding transaction
 * to roll back. Enforces one-write-path discipline structurally: every
 * mutation that goes through `withJournaledTx` either co-commits a journal
 * row or rolls back atomically.
 *
 * Generic over `TEvent`: callers pass their own event union. Core imposes
 * no shape on the event — it's just the payload forwarded to `rawAppend`.
 */

/** Opaque transaction handle passed through from drizzle. */
export type Tx = unknown

/** Minimal drizzle-shaped DB handle. `PostgresJsDatabase<Schema>` satisfies this. */
export interface JournaledTxDb {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

/** Signature of the raw journal-append writer supplied by the caller. */
export type RawJournalAppend<TEvent> = (event: TEvent, tx: Tx) => Promise<void>

/**
 * Journal sink handed to the inner callback of `withJournaledTx`. Calling
 * `append` (any number of times) marks the tx as journaled; missing calls
 * cause the tx wrapper to throw at commit time.
 */
export interface JournalSink<TEvent> {
  append(event: TEvent, tx: Tx): Promise<void>
}

/** Thrown if `fn` never called `journal.append(...)` inside the tx. */
export class MissingJournalAppendError extends Error {
  override readonly name = 'MissingJournalAppendError'
  constructor() {
    super('withJournaledTx: fn committed without invoking journal.append(event, tx)')
  }
}

export interface WithJournaledTxInput<TEvent> {
  db: JournaledTxDb
  rawAppend: RawJournalAppend<TEvent>
}

/**
 * Build a `withJournaledTx` bound to a db + raw-append writer. The returned
 * function runs `fn` inside `db.transaction(...)` with a tracking sink;
 * commits only if the sink was invoked at least once.
 */
export function createWithJournaledTx<TEvent>(
  input: WithJournaledTxInput<TEvent>,
): <T>(fn: (tx: Tx, journal: JournalSink<TEvent>) => Promise<T>) => Promise<T> {
  const { db, rawAppend } = input
  return function withJournaledTx<T>(fn: (tx: Tx, journal: JournalSink<TEvent>) => Promise<T>): Promise<T> {
    return db.transaction(async (tx: Tx) => {
      let journaled = false
      const sink: JournalSink<TEvent> = {
        async append(event: TEvent, innerTx: Tx): Promise<void> {
          journaled = true
          await rawAppend(event, innerTx)
        },
      }
      const result = await fn(tx, sink)
      if (!journaled) {
        throw new MissingJournalAppendError()
      }
      return result
    })
  }
}

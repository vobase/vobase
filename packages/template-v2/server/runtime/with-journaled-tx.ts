/**
 * Transactional write path with mandatory journal append.
 *
 * Wraps `drizzle.transaction(...)` with a `JournalSink` that tracks whether
 * `journal.append(event, tx)` was invoked inside the tx. On commit, if the
 * sink was never called, throws `MissingJournalAppendError` — which causes
 * the surrounding `db.transaction` to roll back. This enforces one-write-path
 * discipline structurally: every mutation that goes through `withJournaledTx`
 * either co-commits a journal row or rolls back atomically.
 *
 * Phase 0: opt-in. Existing service files keep using `db.transaction(...)`
 * directly until their module migrates in Steps 6+.
 */

import type { AgentEvent } from '@server/contracts/event'
import type { JournalSink, ScopedDb, Tx } from '@server/contracts/plugin-context'

/** Signature of the raw journal-append writer supplied by `modules/agents/service/journal.ts`. */
export type RawJournalAppend = (event: AgentEvent, tx: Tx) => Promise<void>

/** Thrown if `fn` never called `journal.append(...)` inside the tx. */
export class MissingJournalAppendError extends Error {
  override readonly name = 'MissingJournalAppendError'
  constructor() {
    super('withJournaledTx: fn committed without invoking journal.append(event, tx)')
  }
}

export interface WithJournaledTxInput {
  db: ScopedDb
  rawAppend: RawJournalAppend
}

export function createWithJournaledTx(
  input: WithJournaledTxInput,
): <T>(fn: (tx: Tx, journal: JournalSink) => Promise<T>) => Promise<T> {
  const { db, rawAppend } = input
  return async function withJournaledTx<T>(fn: (tx: Tx, journal: JournalSink) => Promise<T>): Promise<T> {
    return db.transaction(async (tx: Tx) => {
      let journaled = false
      const sink: JournalSink = {
        async append(event: AgentEvent, innerTx: Tx): Promise<void> {
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

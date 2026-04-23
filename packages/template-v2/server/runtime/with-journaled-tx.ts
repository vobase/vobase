/**
 * Re-export of `withJournaledTx` from `@vobase/core`.
 *
 * The generic implementation now lives in core (`src/harness/with-journaled-tx.ts`)
 * parameterised over `TEvent`. This module keeps the `@server/runtime/`
 * import path alive during the 2c.2 migration; callers should migrate to
 * `import { createWithJournaledTx, MissingJournalAppendError } from '@vobase/core'`
 * when they're rewritten for the new module shape. Deleted alongside the rest
 * of `server/runtime/` in the 2c.3 bootstrap flip.
 */

export {
  createWithJournaledTx,
  type JournaledTxDb,
  type JournalSink,
  MissingJournalAppendError,
  type RawJournalAppend,
  type Tx,
  type WithJournaledTxInput,
} from '@vobase/core'

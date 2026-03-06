---
name: gap-free-sequences
description: >-
  Gap-free business number generation for ERP records with transaction-safe sequencing.
  Use when creating invoice, order, shipment, or document numbers that must be
  unique per prefix, auditable, and safe under concurrent writes.
category: core
domain: [erp, data-integrity]
tier: core
---

# Gap-Free Sequences

`nextSequence(db, prefix, options?)` generates human-readable business numbers
such as `INV-0001` using the core `_sequences` table.

## Why This Matters

- Financial and compliance documents often require deterministic, auditable numbering.
- Auto-increment IDs are not business numbers and can produce gaps after failed writes.
- Concurrent requests can create duplicate numbers if increment logic runs in app memory.
- Vobase centralizes sequence generation in `nextSequence()` to enforce one safe pattern.

## Schema Patterns

`_sequences` is a core system table managed by `@vobase/core`. Module code should
use it through `nextSequence()`, not recreate its logic.

```sql
CREATE TABLE IF NOT EXISTS _sequences (
  id TEXT PRIMARY KEY NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  current_value INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

Notes:

- `prefix` is the counter namespace (`INV`, `ORD`, `PO`, etc.).
- `current_value` stores the latest issued number for that prefix.
- `updated_at` tracks the last increment timestamp.

## Business Rules

- Generate business numbers inside the same database transaction that inserts the
  business record.
- Use `nextSequence(tx, 'INV')` with a transaction handle (`tx`) to keep numbering
  and insert atomic.
- Concurrent access safety comes from SQL UPSERT in `nextSequence()`, not from
  in-memory counters or explicit application locks.
- Prefix format is configurable with `SequenceOptions`:
  - `padLength` (default `4`)
  - `separator` (default `-`)
  - `yearPrefix` (default `false`)
- The counter key is `prefix`; formatting options do not create separate counters.

Usage pattern:

```ts
await ctx.db.transaction(async (tx) => {
  const number = nextSequence(tx, 'INV');
  // Persist invoice with number in this same transaction.
});
```

## Validation Patterns

- Concurrent generation: run parallel `nextSequence(tx, 'INV')` calls and assert
  unique, monotonic outputs without duplicates.
- Rollback gap-free guarantee: call `nextSequence(tx, 'INV')`, force rollback,
  then verify the next committed transaction does not skip.
- Prefix collision checks: confirm `INV` and `ORD` maintain independent counters.
- Formatting checks: verify defaults, custom `padLength`, custom `separator`, and
  `yearPrefix` output shape.

## Common Mistakes

- Using auto-increment primary keys as business-facing invoice/order numbers.
- Generating numbers outside the transaction that writes the business document.
- Expecting `yearPrefix: true` to reset counters yearly (it changes output format only).
- Assuming different formatting options for one prefix produce independent counters.

## References

- [nextSequence API and usage patterns](references/implementation.md)
- [Concurrency, rollback, and configuration edge cases](references/edge-cases.md)

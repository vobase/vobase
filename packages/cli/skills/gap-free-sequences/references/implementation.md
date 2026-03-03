# `nextSequence()` API Walkthrough

This reference documents the public usage contract of
`packages/core/src/sequence.ts`.

## Signature

```ts
nextSequence(
  db: VobaseDb,
  prefix: string,
  options?: {
    padLength?: number;   // default: 4
    separator?: string;   // default: '-'
    yearPrefix?: boolean; // default: false
  },
): string
```

- `db`: Vobase database handle. In business flows, pass the transaction handle (`tx`).
- `prefix`: Logical sequence namespace (`INV`, `ORD`, `PO`, etc.).
- `options`: Output formatting controls.

## Return Value

`nextSequence()` returns a formatted business number string.

- Default format: `${prefix}${separator}${paddedValue}`
- With `yearPrefix: true`: `${prefix}${separator}${year}${separator}${paddedValue}`

Concrete usage examples:

```ts
nextSequence(db, 'INV'); // 'INV-0001'
nextSequence(db, 'INV', { yearPrefix: true }); // 'INV-2026-0001'
nextSequence(db, 'INV', { padLength: 6 }); // 'INV-000001'
```

Note: the year component is derived at runtime, so `2026` in examples is illustrative.

## `_sequences` Table Structure

`_sequences` is a core system table created by Vobase.

```sql
CREATE TABLE IF NOT EXISTS _sequences (
  id TEXT PRIMARY KEY NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  current_value INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

## SQL UPSERT Pattern Used by `nextSequence()`

The function uses a single atomic SQL UPSERT statement per call:

```sql
INSERT INTO _sequences (id, prefix, current_value, updated_at)
VALUES (:id, :prefix, 1, :now)
ON CONFLICT (prefix) DO UPDATE
SET current_value = current_value + 1,
    updated_at = :now
RETURNING current_value;
```

Behavior:

- First call for a prefix inserts `current_value = 1`.
- Later calls on the same prefix increment and return the new value.
- Returned numeric value is padded and formatted into the final string.

## Options Behavior

- `padLength`: Zero-padding width for the numeric segment (`4` -> `0001`).
- `separator`: Delimiter between tokens (default `-`).
- `yearPrefix`: Inserts current year between prefix and numeric segment.

Important: counter partitioning is by `prefix` only. Formatting options change
output text but do not create separate sequence counters.

## Recommended Usage Pattern

Generate and persist within the same transaction:

```ts
await ctx.db.transaction(async (tx) => {
  const invoiceNumber = nextSequence(tx, 'INV');
  await tx.insert(invoices).values({
    number: invoiceNumber,
    // ...other fields
  });
});
```

This keeps sequence allocation and record creation atomic.

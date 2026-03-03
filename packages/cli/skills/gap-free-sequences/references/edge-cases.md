# Gap-Free Sequence Edge Cases

This reference covers operational edge cases when using `nextSequence()` for
business-facing numbers.

## Concurrent Access

`nextSequence()` is concurrency-safe per prefix because it relies on an atomic
UPSERT keyed by `prefix` (`UNIQUE`).

Validation pattern:

```ts
const numbers = await Promise.all(
  Array.from({ length: 20 }, () =>
    db.transaction(async (tx) => nextSequence(tx, 'INV')),
  ),
);

const sorted = [...numbers].sort();
expect(new Set(numbers).size).toBe(20);
expect(sorted[0]).toBe('INV-0001');
expect(sorted[19]).toBe('INV-0020');
```

Notes:

- Assert uniqueness first; parallel promise resolution order is not deterministic.
- Guarantee scope is per prefix (`INV` stream is independent from `ORD`).

## Rollback Scenarios

Gap-free behavior depends on transaction scope.

If sequence generation and record insert run in the same transaction, rollback
reverts both operations.

Validation pattern:

```ts
await expect(
  db.transaction(async (tx) => {
    nextSequence(tx, 'INV');
    throw new Error('force rollback');
  }),
).rejects.toThrow();

const committed = await db.transaction(async (tx) => nextSequence(tx, 'INV'));
expect(committed).toBe('INV-0001');
```

Anti-pattern:

- Calling `nextSequence(db, 'INV')` outside a transaction and then failing later
  during record creation can consume numbers and create visible gaps.

## Prefix Configuration and Collision Rules

- `_sequences.prefix` is unique and defines the sequence namespace.
- Same prefix means same counter, even when options differ.
- Different prefixes (`INV`, `ORD`) always have separate counters.

Example:

```ts
nextSequence(db, 'INV'); // INV-0001
nextSequence(db, 'INV', { padLength: 6 }); // INV-000002 (same counter, different format)
nextSequence(db, 'ORD'); // ORD-0001 (independent counter)
```

## `yearPrefix` Semantics

`yearPrefix: true` affects string formatting only; it does not reset counters by
calendar year.

- 2026: `INV-2026-0001`
- 2027 next call on same prefix may be `INV-2027-0002`

If yearly reset is required, include year in the prefix namespace itself.

```ts
const year = new Date().getFullYear();
const number = nextSequence(tx, `INV-${year}`);
```

## Gap-Free Guarantee Boundaries

What is guaranteed:

- No duplicates for committed transactions on the same prefix.
- Monotonic increment per prefix.
- Rollback-safe sequencing when called with the transaction handle.

What is not guaranteed:

- A single global sequence across multiple prefixes.
- Automatic yearly resets when only `yearPrefix` is enabled.
- Gap-free behavior if sequence generation is outside the write transaction.

---
"@vobase/core": patch
---

# Shorten default nanoid IDs from 12 to 8 characters

Reduced the default nanoid primary key length from 12 to 8 characters across all tables. Each Vobase project is single-tenant with relatively small data volumes, so 12 characters of entropy was unnecessarily long. 8 characters with a 36-char alphabet provides ~41 bits of entropy (~2.8 trillion possible IDs) — more than sufficient.

## Changes

- `NANOID_LENGTH.DEFAULT`: 12 → 8
- `NANOID_LENGTH.SHORT`: 8 → 6
- `NANOID_LENGTH.LONG`: 16 → 12
- Updated all hardcoded `nanoid(12)` SQL in test fixtures to `nanoid(8)`

## Migration Note

Existing databases need a `bun run db:push` (dev) or new migration (prod) to pick up the new column defaults. Existing rows with 12-char IDs remain valid — only newly inserted rows will use 8-char IDs.

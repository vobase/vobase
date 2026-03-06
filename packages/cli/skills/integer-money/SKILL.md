---
name: integer-money
description: >-
  Use when designing ERP schemas, handlers, and tests that store or compute
  money. Enforce integer-cent storage so totals stay exact and auditable.
category: core
domain: [erp, financial, data-integrity]
tier: core
---

# Integer Money

Use this skill when any module stores or calculates financial values.

## Why This Matters

IEEE 754 floating-point math introduces tiny errors that become real money discrepancies at ERP scale.

```javascript
0.1 + 0.2 // 0.30000000000000004 (not 0.3)
1.005 * 100 // 100.49999999999999 (not 100.5)
```

When these values are rounded inconsistently across line items, taxes, discounts, and rollups, reports drift.
Store dollars as integer cents so arithmetic is exact.

- `$142.50` is stored as `14250`
- `0.10 + 0.20` is `10 + 20 = 30` cents

## Schema Patterns

- Monetary columns always use the `_cents` suffix: `amount_cents`, `unit_price_cents`, `tax_cents`, `total_cents`.
- Drizzle definition for money fields is always integer.
- Display conversion happens at the UI boundary: `(cents / 100).toFixed(2)`.
- Safe range for dollar values is `Number.MAX_SAFE_INTEGER / 100` (documented in Vobase convention as safely covering ~$90 billion scale ledgers).

```typescript
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  amount_cents: integer('amount_cents').notNull(),
  tax_cents: integer('tax_cents').notNull().default(0),
  total_cents: integer('total_cents').notNull(),
})

export const line_items = sqliteTable('line_items', {
  id: text('id').primaryKey(),
  invoice_id: text('invoice_id').notNull(),
  quantity: integer('quantity').notNull(),
  unit_price_cents: integer('unit_price_cents').notNull(),
  line_total_cents: integer('line_total_cents').notNull(),
})
```

## Business Rules

- Persist all monetary values as integer cents, never as floats.
- Use `_cents` naming for every stored money field.
- Convert dollars to cents at input boundaries: `cents = Math.round(dollars * 100)`.
- Perform all business arithmetic in cents (`*_cents`), not display values.
- Never define money columns with `real()` or any float representation.
- This skill defines documentation conventions only; do not ship runtime money helper utilities here.

## Validation Patterns

- Rounding test cases verify cent conversion behavior:
  - `0.1 + 0.2` dollars should end as `30` cents, never `29` or `31`.
  - `1.005` dollars should round to `101` cents under standard half-up display rules.
- Aggregation accuracy tests enforce integer invariants:
  - `sum(line_total_cents) === subtotal_cents`
  - `subtotal_cents + tax_cents - discount_cents === total_cents`
- Currency display tests ensure deterministic formatting:
  - `14250 -> "142.50"`
  - `0 -> "0.00"`
  - `-125 -> "-1.25"`

## Common Mistakes

- Using `real('amount')` for money columns.
- Storing dollars as floats (`amount: 142.5`) instead of integer cents.
- Rounding too early or repeatedly during multi-step calculations.
- Running arithmetic on formatted display strings instead of raw cents.
- Mixing dollar units and cent units in the same calculation path.

## References

- [Calculation Patterns](references/calculations.md)

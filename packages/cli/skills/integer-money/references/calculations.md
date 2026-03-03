# Integer Money Calculation Patterns

This reference documents arithmetic conventions only. It does not ship runtime helpers.

## Safe Arithmetic Patterns

Keep all intermediate values in cents.

```typescript
// Good: integer cents all the way through
const subtotalCents = quantity * unitPriceCents
const discountCents = Math.round(subtotalCents * discountBps / 10_000)
const totalCents = subtotalCents - discountCents
```

```typescript
// Bad: float dollars in intermediate math
const subtotal = quantity * unitPrice
const discount = subtotal * 0.1
const total = subtotal - discount
```

Recommended patterns:

- Use `_cents` for stored values and computed totals.
- Use basis points (`bps`) for percentages (`1% = 100 bps`, `8.25% = 825 bps`).
- Round once at the boundary where a fractional cent appears.

## Aggregation Patterns

Aggregate with integer sums, then derive totals.

```typescript
const lineTotalsCents = lines.map((l) => l.quantity * l.unitPriceCents)
const subtotalCents = lineTotalsCents.reduce((sum, n) => sum + n, 0)
const taxCents = Math.round(subtotalCents * taxBps / 10_000)
const totalCents = subtotalCents + taxCents - discountCents
```

Invariants to enforce:

- `sum(line_total_cents) === subtotal_cents`
- `subtotal_cents + tax_cents - discount_cents === total_cents`
- Stored invoice totals must exactly match recomputed totals from line data.

For partial allocations (shipping, discounts, adjustments):

1. Compute each allocation in cents using exact integer math where possible.
2. If a remainder exists after rounding, distribute the extra cent(s) deterministically (e.g., largest remainder, stable line order).
3. Re-check total invariants after allocation.

## Percentage Calculations With Integer Cents

Represent rates as basis points instead of floats.

- `5% -> 500 bps`
- `8.25% -> 825 bps`
- `19.6% -> 1960 bps`

```typescript
const taxBps = 825
const subtotalCents = 14_250 // $142.50
const taxCents = Math.round(subtotalCents * taxBps / 10_000) // 1,176
const totalCents = subtotalCents + taxCents // 15,426
```

Avoid rate math like `subtotal * 0.0825` in business logic.

## Display Conversion Patterns

Convert only at IO boundaries (API/view layer).

```typescript
const display = (cents / 100).toFixed(2)
```

Examples:

- `14250 -> "142.50"`
- `99 -> "0.99"`
- `0 -> "0.00"`
- `-125 -> "-1.25"`

Input handling guidance:

- Prefer parsing user-entered currency as text, then convert to cents once.
- Persist only integer cents to the database.
- Never store pre-formatted strings (`"142.50"`) as the canonical money value.

## IEEE 754 Failure Demonstration

Use these examples in tests and reviews to explain why floats are banned for money:

```javascript
0.1 + 0.2 // 0.30000000000000004
1.005 * 100 // 100.49999999999999
```

Integer-cents equivalent:

```javascript
10 + 20 // 30 cents (0.30)
```

# Transition Patterns

Common lifecycle maps with server-side transition validation snippets.

```typescript
function assertTransition(
  map: Record<string, string[]>,
  current: string,
  next: string,
): void {
  const allowed = map[current] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`Cannot transition from ${current} to ${next}`);
  }
}
```

## Invoice

Transition map:

| From | Allowed next |
|---|---|
| `draft` | `sent`, `void` |
| `sent` | `partial`, `paid`, `void` |
| `partial` | `paid`, `void` |
| `paid` | `void` |
| `void` | _(terminal)_ |

Example validation code:

```typescript
const INVOICE_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'void'],
  sent: ['partial', 'paid', 'void'],
  partial: ['paid', 'void'],
  paid: ['void'],
  void: [],
};

assertTransition(INVOICE_TRANSITIONS, current.status, nextStatus);
```

## Purchase Order

Transition map:

| From | Allowed next |
|---|---|
| `draft` | `approved`, `void` |
| `approved` | `ordered`, `void` |
| `ordered` | `received`, `void` |
| `received` | `closed`, `void` |
| `closed` | _(terminal)_ |
| `void` | _(terminal)_ |

Example validation code:

```typescript
const PURCHASE_ORDER_TRANSITIONS: Record<string, string[]> = {
  draft: ['approved', 'void'],
  approved: ['ordered', 'void'],
  ordered: ['received', 'void'],
  received: ['closed', 'void'],
  closed: [],
  void: [],
};

assertTransition(PURCHASE_ORDER_TRANSITIONS, current.status, nextStatus);
```

## Payment

Transition map:

| From | Allowed next |
|---|---|
| `pending` | `processing`, `failed` |
| `processing` | `settled`, `failed` |
| `settled` | `refunded` |
| `failed` | _(terminal)_ |
| `refunded` | _(terminal)_ |

Example validation code:

```typescript
const PAYMENT_TRANSITIONS: Record<string, string[]> = {
  pending: ['processing', 'failed'],
  processing: ['settled', 'failed'],
  settled: ['refunded'],
  failed: [],
  refunded: [],
};

assertTransition(PAYMENT_TRANSITIONS, current.status, nextStatus);
```

## Shipment

Transition map:

| From | Allowed next |
|---|---|
| `pending` | `picked` |
| `picked` | `packed` |
| `packed` | `shipped` |
| `shipped` | `delivered`, `returned` |
| `delivered` | _(terminal)_ |
| `returned` | _(terminal)_ |

Example validation code:

```typescript
const SHIPMENT_TRANSITIONS: Record<string, string[]> = {
  pending: ['picked'],
  picked: ['packed'],
  packed: ['shipped'],
  shipped: ['delivered', 'returned'],
  delivered: [],
  returned: [],
};

assertTransition(SHIPMENT_TRANSITIONS, current.status, nextStatus);
```

## Handler Integration Pattern

Use this shape in Hono handlers before any side effects:

```typescript
const row = await ctx.db.query.invoices.findFirst({
  where: (invoices, { eq }) => eq(invoices.id, id),
  columns: { status: true },
});

if (!row) {
  return c.json({ error: 'Not found' }, 404);
}

try {
  assertTransition(INVOICE_TRANSITIONS, row.status, body.status);
} catch (err) {
  return c.json({ error: String(err) }, 422);
}

await ctx.db.update(invoices).set({ status: body.status }).where(eq(invoices.id, id));
```

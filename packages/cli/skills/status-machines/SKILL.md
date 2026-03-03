---
name: status-machines
description: >-
  Use when implementing ERP status fields and workflow transitions. Enforce explicit
  state maps in handlers, reject invalid jumps, and audit every status mutation to
  preserve data integrity.
category: horizontal
domain: [erp, workflow, data-integrity]
tier: core
---

# Status Machines

Use this skill when a module has business statuses that must move through a controlled lifecycle.

## Why This Matters

Implicit status changes (arbitrary string updates) cause silent data corruption. A transition like `paid -> draft` should never happen, but it happens quickly when handlers do `UPDATE ... SET status = ?` without validating the current state.

Without explicit transitions, AI agents often generate direct updates such as `WHERE id = ? UPDATE SET status = 'paid'` with no guard. This bypasses business controls, breaks reporting assumptions, and destroys auditability.

Status transitions are not UI hints. They are business invariants that must be enforced server-side.

## Schema Patterns

Define status as a required text column with a deterministic default:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { nanoidPrimaryKey } from '@vobase/core';

export const invoices = sqliteTable('invoices', {
  id: nanoidPrimaryKey(),
  number: text('number').notNull(),
  amount_cents: integer('amount_cents').notNull(),
  status: text('status').notNull().default('draft'),
});
```

Keep the transition map in code near handlers so allowed edges stay explicit and reviewable:

```typescript
const INVOICE_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'void'],
  sent: ['paid', 'void'],
  paid: [],
  void: [],
};
```

Concrete flow examples:

- Invoice: `draft -> sent -> paid -> void`
- Purchase order: `draft -> approved -> ordered -> received -> closed`

## Business Rules

1. Define valid transitions as an explicit map per aggregate.
2. Validate transitions in the handler before updating.
3. Reject invalid transitions with `422` and a clear error payload.
4. Log old/new status in audit trail for every accepted transition.

Transition validation pattern (inline in handler, no workflow engine):

```typescript
import { eq } from 'drizzle-orm';

const TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'void'],
  sent: ['paid', 'void'],
  paid: [],
  void: [],
};

routes.post('/invoices/:id/status', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const { status: newStatus } = await c.req.json<{ status: string }>();

  const current = await ctx.db.query.invoices.findFirst({
    where: (invoices, { eq }) => eq(invoices.id, id),
    columns: { id: true, status: true },
  });

  if (!current) {
    return c.json({ error: 'Invoice not found' }, 404);
  }

  const allowed = TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return c.json(
      { error: `Cannot transition from ${current.status} to ${newStatus}` },
      422,
    );
  }

  await ctx.db
    .update(invoices)
    .set({ status: newStatus })
    .where(eq(invoices.id, id));

  await trackChanges(ctx.db, 'invoices', id, { status: current.status }, { status: newStatus }, ctx.user.id);

  return c.json({ ok: true });
});
```

## Validation Patterns

- Invalid edge test: `draft -> paid` returns `422` and record remains `draft`.
- Happy path test: every declared edge succeeds exactly once (e.g., `draft -> sent`, `sent -> paid`).
- Terminal state test: states with no outgoing edges reject all next statuses.
- Audit test: valid transition writes one audit entry with old/new status and actor.
- Regression test: `paid -> draft` is always rejected.

## Common Mistakes

- Updating `status` via arbitrary strings with no transition map.
- Validating only in frontend and skipping server-side checks.
- Forgetting to include newly introduced statuses in the transition map.
- Allowing reverse transitions such as `paid -> draft`.
- Mixing side effects before transition validation (emails, stock moves, ledger writes).

## References

- [Transition Patterns](references/transition-patterns.md)

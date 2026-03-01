# Query Patterns Reference

## Select

```typescript
import { eq, ne, gt, gte, lt, lte, like, and, or, not, isNull, isNotNull,
         inArray, notInArray, between, desc, asc, sql, count, sum, avg } from 'drizzle-orm';

// All rows
const all = await db.select().from(users);

// Single row
const [user] = await db.select().from(users).where(eq(users.id, 1));

// Specific columns
const names = await db.select({ id: users.id, name: users.name }).from(users);

// With alias
const { id, name } = getTableColumns(users);
const result = await db.select({ userId: id, userName: name }).from(users);

// WHERE with multiple conditions
await db.select().from(users).where(
  and(
    eq(users.status, 'active'),
    gt(users.createdAt, someDate),
    or(
      like(users.name, '%john%'),
      like(users.email, '%john%'),
    ),
  )
);

// ORDER BY, LIMIT, OFFSET
await db.select().from(users)
  .orderBy(desc(users.createdAt))
  .limit(10)
  .offset(20);

// COUNT
const [{ total }] = await db.select({ total: count() }).from(users);

// GROUP BY with aggregates
await db.select({
  status: orders.status,
  count: count(),
  totalCents: sum(orders.totalCents),
})
.from(orders)
.groupBy(orders.status);

// DISTINCT
await db.selectDistinct({ status: users.status }).from(users);
```

## Insert

```typescript
// Single insert
await db.insert(users).values({ email: 'a@b.com', name: 'Alice' });

// Insert with returning
const [user] = await db.insert(users)
  .values({ email: 'a@b.com', name: 'Alice' })
  .returning();

// Batch insert
await db.insert(users).values([
  { email: 'a@b.com', name: 'Alice' },
  { email: 'b@c.com', name: 'Bob' },
]);

// Insert or ignore
await db.insert(users)
  .values({ email: 'a@b.com', name: 'Alice' })
  .onConflictDoNothing();

// Upsert (insert or update on conflict)
await db.insert(users)
  .values({ email: 'a@b.com', name: 'Alice' })
  .onConflictDoUpdate({
    target: users.email,
    set: {
      name: sql`excluded.name`,
      updatedAt: new Date(),
    },
  });
```

## Update

```typescript
// Basic update
await db.update(users)
  .set({ name: 'Robert' })
  .where(eq(users.id, 1));

// Update with returning
const [updated] = await db.update(users)
  .set({ status: 'active' })
  .where(eq(users.id, 1))
  .returning();

// Increment
await db.update(accounts)
  .set({ balance: sql`${accounts.balance} + 100` })
  .where(eq(accounts.id, 1));
```

## Delete

```typescript
// Basic delete
await db.delete(users).where(eq(users.id, 1));

// Delete with returning
const [deleted] = await db.delete(users)
  .where(eq(users.id, 1))
  .returning();

// Delete all (dangerous!)
await db.delete(users);
```

## Joins

```typescript
// Inner join
await db.select({
  user: users,
  order: orders,
})
.from(users)
.innerJoin(orders, eq(users.id, orders.customerId));

// Left join
await db.select()
  .from(users)
  .leftJoin(orders, eq(users.id, orders.customerId));

// Multiple joins
await db.select({
  user: users.name,
  order: orders.id,
  item: orderItems.productName,
})
.from(orders)
.innerJoin(users, eq(orders.customerId, users.id))
.innerJoin(orderItems, eq(orders.id, orderItems.orderId));
```

## Transactions

Bun SQLite supports real transactions (unlike Cloudflare D1):

```typescript
// Basic transaction
await db.transaction(async (tx) => {
  const [order] = await tx.insert(orders)
    .values({ customerId: 1, totalCents: 5000, status: 'pending' })
    .returning();

  await tx.insert(orderItems).values([
    { orderId: order.id, productName: 'Widget', priceCents: 2500 },
    { orderId: order.id, productName: 'Gadget', priceCents: 2500 },
  ]);
});

// Transaction with rollback on error (automatic)
try {
  await db.transaction(async (tx) => {
    await tx.update(accounts).set({ balance: sql`balance - 100` }).where(eq(accounts.id, 1));
    await tx.update(accounts).set({ balance: sql`balance + 100` }).where(eq(accounts.id, 2));
    // If any statement throws, entire transaction rolls back
  });
} catch (e) {
  console.error('Transaction failed:', e);
}

// Nested savepoints
await db.transaction(async (tx) => {
  await tx.insert(users).values({ email: 'a@b.com', name: 'A' });

  try {
    await tx.transaction(async (nested) => {
      await nested.insert(users).values({ email: 'b@c.com', name: 'B' });
      throw new Error('rollback inner only');
    });
  } catch {
    // Inner savepoint rolled back, outer continues
  }

  // User A is still inserted
});
```

## Dynamic Query Building

```typescript
// Using .$dynamic()
function getUsers(filters: { name?: string; status?: string; limit?: number }) {
  let query = db.select().from(users).$dynamic();

  const conditions = [];
  if (filters.name) conditions.push(like(users.name, `%${filters.name}%`));
  if (filters.status) conditions.push(eq(users.status, filters.status));

  if (conditions.length) query = query.where(and(...conditions));
  if (filters.limit) query = query.limit(filters.limit);

  return query;
}
```

## Subqueries

```typescript
// Subquery in WHERE
const sq = db.select({ id: users.id }).from(users).where(eq(users.status, 'active'));
await db.select().from(orders).where(inArray(orders.customerId, sq));

// Subquery as derived table
const sq = db.select({
  customerId: orders.customerId,
  total: sum(orders.totalCents).as('total'),
}).from(orders).groupBy(orders.customerId).as('order_totals');

await db.select({
  name: users.name,
  total: sq.total,
}).from(users).leftJoin(sq, eq(users.id, sq.customerId));
```

## Raw SQL

```typescript
import { sql } from 'drizzle-orm';

// Raw query
const result = await db.run(sql`PRAGMA table_info(users)`);

// Raw in select
await db.select({
  id: users.id,
  upperName: sql<string>`UPPER(${users.name})`,
}).from(users);

// Raw in where
await db.select().from(users)
  .where(sql`${users.createdAt} > strftime('%s', 'now', '-7 days')`);
```

## Prepared Statements

```typescript
// Prepare a statement for repeated use
const prepared = db.select().from(users).where(eq(users.id, sql.placeholder('id'))).prepare();

// Execute with different params
const user1 = await prepared.execute({ id: 1 });
const user2 = await prepared.execute({ id: 2 });
```

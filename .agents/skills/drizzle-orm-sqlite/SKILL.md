---
name: drizzle-orm-sqlite
description: >-
  Drizzle ORM with Bun SQLite (bun:sqlite) for type-safe database operations, schema design,
  migrations, and query patterns. Use when working with Drizzle ORM and SQLite in Bun projects,
  including: (1) Setting up Drizzle with bun:sqlite driver, (2) Defining SQLite schemas with
  sqliteTable, (3) Running migrations with drizzle-kit, (4) Writing queries (select, insert,
  update, delete, joins, transactions), (5) Debugging query issues or migration errors,
  (6) Performance tuning SQLite with WAL mode, indexes, and PRAGMAs. Triggers on: "drizzle",
  "sqlite", "bun:sqlite", "schema", "migration", "sqliteTable", "drizzle-kit", "db query",
  "database setup", "ORM".
---

# Drizzle ORM for Bun SQLite

**Runtime**: Bun (`bun:sqlite`) | **Dialect**: SQLite | **Packages**: `drizzle-orm`, `drizzle-kit`

## Quick Start

```bash
bun add drizzle-orm
bun add -D drizzle-kit
```

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
});
```

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';

const sqlite = new Database('sqlite.db');
export const db = drizzle({ client: sqlite });
```

```bash
# Generate & apply migrations
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

---

## Bun SQLite Driver Specifics

### Initialization

```typescript
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';

// Option 1: Let Drizzle create the connection (in-memory)
const db = drizzle();

// Option 2: Provide existing bun:sqlite Database
const sqlite = new Database('mydb.sqlite');
const db = drizzle({ client: sqlite });

// Option 3: With schema for relational queries
import * as schema from './schema';
const db = drizzle({ client: sqlite, schema });

// Option 4: With logging
const db = drizzle({ client: sqlite, logger: true });
```

### Sync vs Async API

`bun:sqlite` is synchronous. Drizzle provides both async and sync APIs:

```typescript
// Async (default, works everywhere)
const result = await db.select().from(users);

// Sync methods (bun:sqlite only)
const all    = db.select().from(users).all();     // T[]
const one    = db.select().from(users).get();      // T | undefined
const vals   = db.select().from(users).values();   // unknown[][]
const info   = db.insert(users).values({...}).run(); // SQLiteRunResult
```

### Performance PRAGMAs

Apply at connection init for optimal performance:

```typescript
const sqlite = new Database('mydb.sqlite');

sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA synchronous = NORMAL');
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec('PRAGMA temp_store = MEMORY');
sqlite.exec('PRAGMA cache_size = -64000'); // 64MB
sqlite.exec('PRAGMA mmap_size = 30000000000');

const db = drizzle({ client: sqlite });
```

---

## Critical Rules

### DO

- Use `integer` with `mode: 'timestamp'` for dates — SQLite has no native date type
- Use `.$defaultFn()` for dynamic defaults (not `.default()` with functions)
- Use `PRAGMA foreign_keys = ON` — SQLite disables foreign keys by default
- Use `PRAGMA journal_mode = WAL` for concurrent read/write
- Use `db.transaction()` for atomic multi-statement operations
- Use `integer` for money (cents) — never `real` for financial values
- Test migrations on a copy before applying to production data
- Use `InferSelectModel<typeof table>` and `InferInsertModel<typeof table>` for types

### DON'T

- Use `drizzle-kit push` for production — use `generate` + `migrate`
- Use `real` for money — floating point causes rounding errors
- Ignore foreign key enforcement — SQLite defaults to OFF
- Use `.default(new Date())` — this captures the value at schema load time, not at insert time
- Suppress type errors with `as any` or `@ts-ignore`

---

## Schema Patterns

### Column Types

| TypeScript | SQLite Type | Notes |
|---|---|---|
| `integer('col')` | INTEGER | Numbers, booleans (`mode: 'boolean'`), timestamps (`mode: 'timestamp'` or `'timestamp_ms'`) |
| `text('col')` | TEXT | Strings, enums (`{ enum: ['a','b'] }`) |
| `real('col')` | REAL | Floating point (avoid for money) |
| `blob('col')` | BLOB | Binary data, buffers (`mode: 'buffer'`), JSON (`mode: 'json'`) |

### Common Patterns

```typescript
import { sqliteTable, text, integer, real, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  status: text('status', { enum: ['pending', 'paid', 'shipped', 'cancelled'] }).notNull().default('pending'),
  totalCents: integer('total_cents').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  customerId: integer('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$onUpdateFn(() => new Date()),
}, (table) => [
  index('idx_orders_customer').on(table.customerId),
  index('idx_orders_status').on(table.status),
]);
```

For full column type reference and constraint patterns, see [references/schema-patterns.md](references/schema-patterns.md).

---

## Query Patterns

```typescript
import { eq, and, or, like, gt, sql, desc, asc } from 'drizzle-orm';

// Select
const user = await db.select().from(users).where(eq(users.id, 1));

// Insert
const inserted = await db.insert(users)
  .values({ email: 'a@b.com', name: 'Alice' })
  .returning();

// Update
await db.update(users)
  .set({ name: 'Bob' })
  .where(eq(users.id, 1));

// Delete
await db.delete(users).where(eq(users.id, 1));

// Upsert
await db.insert(users)
  .values({ email: 'a@b.com', name: 'Alice' })
  .onConflictDoUpdate({
    target: users.email,
    set: { name: sql`excluded.name` },
  });

// Transactions (bun:sqlite supports real transactions)
await db.transaction(async (tx) => {
  const [user] = await tx.insert(users).values({ email: 'a@b.com', name: 'A' }).returning();
  await tx.insert(orders).values({ customerId: user.id, totalCents: 1000, status: 'pending' });
});
```

For dynamic queries, joins, subqueries, and advanced patterns, see [references/query-patterns.md](references/query-patterns.md).

---

## Migrations

```bash
# Generate migrations from schema changes
bunx drizzle-kit generate

# Apply migrations
bunx drizzle-kit migrate

# Push schema directly (dev only, not for production)
bunx drizzle-kit push

# Introspect existing database → Drizzle schema
bunx drizzle-kit pull

# Open visual database browser
bunx drizzle-kit studio
```

For the full migration workflow and team patterns, see [references/migration-workflow.md](references/migration-workflow.md).

---

## Debugging

```typescript
// Enable query logging
const db = drizzle({ client: sqlite, logger: true });

// Custom logger
const db = drizzle({
  client: sqlite,
  logger: {
    logQuery(query, params) {
      console.log('SQL:', query);
      console.log('Params:', params);
    },
  },
});

// Get SQL without executing
const query = db.select().from(users).where(eq(users.id, 1));
const { sql: sqlStr, params } = query.toSQL();
console.log(sqlStr, params);
```

---

## Known Issues & Gotchas

For a comprehensive list of known issues with solutions, see [references/common-errors.md](references/common-errors.md).

Key issues to be aware of:

1. **Foreign keys OFF by default** — always set `PRAGMA foreign_keys = ON`
2. **`.$defaultFn()` vs `.default()`** — use `$defaultFn` for dynamic values like `new Date()`
3. **Migration CASCADE data loss** — review generated migrations for DROP TABLE with cascade FK references
4. **SQLite type affinity** — SQLite is loosely typed; Drizzle enforces types at the TS level only
5. **`real` for money** — causes rounding; use `integer` with cents

---

## Official Documentation

- **Drizzle ORM**: https://orm.drizzle.team/
- **Drizzle + Bun SQLite**: https://orm.drizzle.team/docs/connect-bun-sqlite
- **Drizzle Kit**: https://orm.drizzle.team/docs/kit-overview
- **Drizzle SQLite column types**: https://orm.drizzle.team/docs/column-types/sqlite
- **Bun SQLite API**: https://bun.sh/docs/api/sqlite
- **Context7 Library**: `/drizzle-team/drizzle-orm-docs`

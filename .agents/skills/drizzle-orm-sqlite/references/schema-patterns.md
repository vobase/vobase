# Schema Patterns Reference

## Column Types

### integer

```typescript
import { integer } from 'drizzle-orm/sqlite-core';

// Plain integer
integer('age')

// Primary key with auto-increment
integer('id').primaryKey({ autoIncrement: true })

// Boolean mode (stored as 0/1)
integer('is_active', { mode: 'boolean' }).notNull().default(false)

// Timestamp mode (stored as Unix seconds)
integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())

// Timestamp_ms mode (stored as Unix milliseconds)
integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date())

// Money (store as cents — never use real/float)
integer('price_cents').notNull().default(0)
```

### text

```typescript
import { text } from 'drizzle-orm/sqlite-core';

// Plain text
text('name').notNull()

// With enum constraint (TS-level only, no DB CHECK)
text('status', { enum: ['active', 'inactive', 'archived'] }).notNull()

// JSON stored as text (use $type for TypeScript inference)
text('metadata', { mode: 'json' }).$type<{ key: string; value: unknown }>()

// With default
text('role').notNull().default('user')
```

### real

```typescript
import { real } from 'drizzle-orm/sqlite-core';

// Floating point — use for coordinates, percentages, non-financial values
real('latitude')
real('longitude')

// NEVER use for money — floating point rounding errors
// Use integer('price_cents') instead
```

### blob

```typescript
import { blob } from 'drizzle-orm/sqlite-core';

// Raw blob
blob('data')

// Buffer mode
blob('file_data', { mode: 'buffer' })

// JSON mode (stored as blob, parsed as JSON)
blob('config', { mode: 'json' }).$type<Config>()

// BigInt mode
blob('big_number', { mode: 'bigint' })
```

## Constraints

```typescript
// NOT NULL
text('name').notNull()

// UNIQUE
text('email').unique()

// DEFAULT (static)
text('role').default('user')
integer('count').default(0)

// DEFAULT (dynamic — use $defaultFn)
integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
text('id').$defaultFn(() => crypto.randomUUID())

// ON UPDATE (dynamic)
integer('updated_at', { mode: 'timestamp' }).$onUpdateFn(() => new Date())

// FOREIGN KEY (inline)
integer('user_id').references(() => users.id)
integer('user_id').references(() => users.id, { onDelete: 'cascade' })
integer('user_id').references(() => users.id, { onDelete: 'set null' })

// CHECK (via sql)
import { sql } from 'drizzle-orm';
integer('age').check(sql`age >= 0 AND age <= 150`)
```

## Indexes

```typescript
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
}, (table) => [
  // Single column index
  index('idx_users_email').on(table.email),

  // Unique index
  uniqueIndex('idx_users_email_unique').on(table.email),

  // Composite index
  index('idx_users_status_created').on(table.status, table.createdAt),

  // Partial index (WHERE clause)
  index('idx_users_active').on(table.email).where(sql`status = 'active'`),
]);
```

## Relations (for relational queries)

```typescript
import { relations } from 'drizzle-orm';

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
}));

// Usage (requires schema passed to drizzle())
const result = await db.query.users.findMany({
  with: { posts: true },
});
```

## Type Inference

```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';

type User = InferSelectModel<typeof users>;        // { id: number; email: string; ... }
type NewUser = InferInsertModel<typeof users>;      // { id?: number; email: string; ... }

// Partial select type
type UserEmail = Pick<User, 'id' | 'email'>;
```

## Common ERP Patterns

### Audit columns

```typescript
const auditColumns = {
  createdAt: integer('created_at', { mode: 'timestamp' as const })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' as const })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
};

export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // ... domain columns
  ...auditColumns,
});
```

### Status transitions

```typescript
export const invoices = sqliteTable('invoices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  status: text('status', {
    enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled', 'void'],
  }).notNull().default('draft'),
  totalCents: integer('total_cents').notNull(),
});
```

### Soft deletes

```typescript
export const records = sqliteTable('records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  // query with: .where(isNull(records.deletedAt))
});
```

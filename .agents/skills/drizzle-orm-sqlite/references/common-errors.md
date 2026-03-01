# Common Errors & Gotchas

## 1. Foreign Keys Not Enforced

**Symptom**: Inserting rows with invalid foreign key references succeeds silently.

**Cause**: SQLite disables foreign key enforcement by default.

**Fix**: Set PRAGMA at connection init:
```typescript
const sqlite = new Database('mydb.sqlite');
sqlite.exec('PRAGMA foreign_keys = ON');
const db = drizzle({ client: sqlite });
```

## 2. `.$defaultFn()` vs `.default()`

**Symptom**: All rows get the same timestamp / UUID.

**Cause**: `.default(new Date())` captures the value once at schema load time.

**Fix**: Use `.$defaultFn()` for dynamic values:
```typescript
// WRONG
integer('created_at', { mode: 'timestamp' }).default(new Date())

// CORRECT
integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
```

## 3. TypeScript Type Instantiation Too Deep

**Error**: `Type instantiation is excessively deep and possibly infinite`

**Cause**: Complex circular references in relations or deep query nesting.

**Fix**: Use explicit types:
```typescript
import { InferSelectModel } from 'drizzle-orm';
type User = InferSelectModel<typeof users>;

// For query results with relations, type manually
type UserWithPosts = User & { posts: Post[] };
```

## 4. Migration CASCADE Data Loss

**Error**: Related data silently deleted during migration.

**Cause**: `drizzle-kit generate` may DROP and recreate tables. If foreign keys use `ON DELETE CASCADE`, all referencing data is deleted.

**Detection**: Review generated SQL for `DROP TABLE` on tables with cascade FK references.

**Fix**: Manually rewrite migration to preserve data:
```sql
CREATE TABLE users_new (...);
INSERT INTO users_new SELECT ... FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
```

## 5. `drizzle-kit push` in Production

**Symptom**: Data loss, schema drift, unreproducible state.

**Cause**: `push` applies schema directly without migration files. No audit trail, no rollback.

**Fix**: Always use `generate` + `migrate` for production:
```bash
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

## 6. Schema Config Not Found

**Error**: `Cannot find drizzle.config.ts`

**Fix**: File must be named `drizzle.config.ts` in project root (or specify `--config` flag).

## 7. `real` for Money

**Symptom**: Financial calculations off by fractions of a cent.

**Cause**: IEEE 754 floating point: `0.1 + 0.2 !== 0.3`.

**Fix**: Store money as integer cents:
```typescript
// WRONG
real('price')  // 19.99 might become 19.990000000000002

// CORRECT
integer('price_cents')  // 1999
```

## 8. SQLite Type Affinity Surprises

**Symptom**: Inserting a string into an integer column succeeds.

**Cause**: SQLite uses type affinity, not strict types. Any value can go in any column unless `STRICT` mode.

**Impact**: Drizzle enforces types at TypeScript level but not at DB level. Validate inputs before insert.

## 9. WAL Mode Not Persisted

**Symptom**: WAL mode resets on restart.

**Cause**: `PRAGMA journal_mode = WAL` is per-connection, but once set on a database file, it persists. However, if the DB file is recreated, it resets.

**Fix**: Always set at connection init:
```typescript
sqlite.exec('PRAGMA journal_mode = WAL');
```

## 10. Batch Insert Performance

**Symptom**: Inserting 1000+ rows is extremely slow.

**Cause**: Each insert without a wrapping transaction auto-commits individually.

**Fix**: Use transactions or `db.insert().values([...])` which batches automatically:
```typescript
// Drizzle batches this into a single transaction
await db.insert(users).values(thousandUsers);

// Or explicit transaction for mixed operations
await db.transaction(async (tx) => {
  for (const chunk of chunks(users, 500)) {
    await tx.insert(usersTable).values(chunk);
  }
});
```

## 11. Relational Queries Without Schema

**Error**: `Cannot read properties of undefined (reading 'findMany')`

**Cause**: Using `db.query.users.findMany()` without passing schema to `drizzle()`.

**Fix**:
```typescript
import * as schema from './schema';
const db = drizzle({ client: sqlite, schema });

// Now works
const users = await db.query.users.findMany({ with: { posts: true } });
```

## 12. `bun:sqlite` Concurrent Write Issues

**Symptom**: `SQLITE_BUSY` errors under concurrent writes.

**Cause**: SQLite allows only one writer at a time.

**Fix**: Use WAL mode + busy timeout:
```typescript
const sqlite = new Database('mydb.sqlite');
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA busy_timeout = 5000'); // wait up to 5s for lock
```

## 13. Timestamp Precision Mismatch

**Symptom**: Dates are off by a factor of 1000.

**Cause**: Mixing `mode: 'timestamp'` (seconds) with `mode: 'timestamp_ms'` (milliseconds) or using `Date.now()` (ms) with `timestamp` mode (s).

**Fix**: Be consistent:
```typescript
// Unix seconds
integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())

// Unix milliseconds
integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date())

// Drizzle handles the conversion — just pass Date objects
```

## 14. `onConflictDoUpdate` Target Must Be Unique

**Error**: `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`

**Cause**: The `target` column in `onConflictDoUpdate` must have a UNIQUE constraint or be the primary key.

**Fix**: Ensure the target column is unique:
```typescript
export const users = sqliteTable('users', {
  email: text('email').notNull().unique(), // Must be unique
});

await db.insert(users)
  .values({ email: 'a@b.com', name: 'A' })
  .onConflictDoUpdate({ target: users.email, set: { name: 'B' } });
```

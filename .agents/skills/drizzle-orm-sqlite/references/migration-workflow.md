# Migration Workflow Reference

## drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Path to schema file(s)
  schema: './src/db/schema.ts',
  // or multiple files:
  // schema: ['./src/db/schema/users.ts', './src/db/schema/orders.ts'],
  // or glob:
  // schema: './src/db/schema/*.ts',

  // Output directory for generated migrations
  out: './migrations',

  // Database dialect
  dialect: 'sqlite',

  // Database file for push/pull/studio
  dbCredentials: {
    url: './sqlite.db',
  },
});
```

## Commands

| Command | Purpose | Production Safe? |
|---|---|---|
| `bunx drizzle-kit generate` | Generate SQL migrations from schema changes | Yes |
| `bunx drizzle-kit migrate` | Apply pending migrations | Yes |
| `bunx drizzle-kit push` | Push schema directly (no migration files) | **Dev only** |
| `bunx drizzle-kit pull` | Introspect DB → generate Drizzle schema | Yes |
| `bunx drizzle-kit check` | Validate migration integrity | Yes |
| `bunx drizzle-kit up` | Upgrade migration snapshots to latest format | Yes |
| `bunx drizzle-kit studio` | Open visual database browser | Dev tool |

## Workflow

### Development

```bash
# 1. Edit schema files
# 2. Generate migration
bunx drizzle-kit generate

# 3. Review generated SQL in ./migrations/
# 4. Apply
bunx drizzle-kit migrate

# Or for rapid iteration (dev only):
bunx drizzle-kit push
```

### Production

```bash
# Generate migration from schema diff
bunx drizzle-kit generate

# Review the generated SQL (CRITICAL — check for DROP TABLE, data loss)
cat migrations/XXXX_*.sql

# Apply in production
bunx drizzle-kit migrate
```

### Programmatic Migration

Apply migrations at app startup:

```typescript
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Database } from 'bun:sqlite';

const sqlite = new Database('sqlite.db');
const db = drizzle({ client: sqlite });

// Run pending migrations
migrate(db, { migrationsFolder: './migrations' });
```

## Custom Migrations

Add custom SQL alongside generated migrations:

```typescript
// drizzle.config.ts
export default defineConfig({
  // ...
  migrations: {
    prefix: 'timestamp', // or 'supabase', 'index'
  },
});
```

Create a custom migration:
```bash
bunx drizzle-kit generate --custom --name=seed_initial_data
```

Then edit the generated SQL file manually.

## Drizzle Studio

```bash
bunx drizzle-kit studio
# Opens http://local.drizzle.studio
```

Features:
- Browse tables and data visually
- Edit records inline
- Run custom SQL queries
- View schema relationships

## Team Workflow

### Avoiding migration conflicts

```bash
# Before generating, pull latest and check for conflicts
git pull
bunx drizzle-kit check

# If collisions detected, regenerate
bunx drizzle-kit generate
```

### Migration naming

Generated migrations follow the pattern: `XXXX_migration_name.sql`

Each migration has a companion `_journal.json` tracking applied state.

## Dangerous Migration Patterns

### DROP TABLE with cascade FK

When Drizzle regenerates a table (column add/remove/type change), it may DROP and recreate:

```sql
-- DANGEROUS if other tables reference this with ON DELETE CASCADE
DROP TABLE users;
CREATE TABLE users (...);
```

**Prevention**: Always review generated SQL. If you see DROP TABLE on a table with cascade FK references, manually rewrite to:

```sql
-- 1. Create new table
CREATE TABLE users_new (...);
-- 2. Copy data
INSERT INTO users_new SELECT ... FROM users;
-- 3. Drop old
DROP TABLE users;
-- 4. Rename
ALTER TABLE users_new RENAME TO users;
```

### PRAGMA foreign_keys in migrations

SQLite migrations should wrap in:

```sql
PRAGMA foreign_keys=OFF;
-- migration statements
PRAGMA foreign_keys=ON;
```

Drizzle generates this automatically, but verify when writing custom migrations.

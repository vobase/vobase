---
"@vobase/core": minor
"create-vobase": minor
---

# PostgreSQL Migration

![PostgreSQL Migration](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-postgres-0.15.png)

**BREAKING CHANGE:** Vobase now uses PostgreSQL instead of SQLite. PGlite provides zero-config embedded Postgres for local development. Production deployments use managed Postgres via `DATABASE_URL`. All SQLite dependencies, APIs, and patterns have been removed.

## Database Engine

| Before | After |
|---|---|
| `bun:sqlite` (synchronous) | PGlite local / `bun:sql` production (async) |
| `sqliteTable` + SQLite column types | `pgTable` + Postgres column types |
| `integer('col', { mode: 'timestamp_ms' })` | `timestamp('col', { withTimezone: true }).defaultNow()` |
| `integer('col', { mode: 'boolean' })` | `boolean('col')` |
| `blob('col')` | `bytea` or `jsonb` |
| `sqlite-vec` virtual tables | Native `pgvector` extension |
| FTS5 | Postgres `tsvector` / `tsquery` |
| JS `nanoid()` via `$defaultFn` | SQL `nanoid()` function via fixtures |
| `.get()` for single row | `[0]` array access |
| `.all()` for multiple rows | Direct array return (removed) |
| Synchronous Drizzle calls | `await` on every query |

The `VobaseDb` type is a single Drizzle Postgres instance — handler code never knows whether PGlite or `bun:sql` is underneath. `createDatabase()` auto-detects from the URL prefix and caches PGlite instances by path to prevent duplicate connections.

## Job Queue: bunqueue → pg-boss

| Before | After |
|---|---|
| `bunqueue` (SQLite-backed) | `pg-boss` (Postgres-backed) |
| Separate SQLite file for jobs | Same Postgres database |
| `FlowProducer` for job chains | Priority queues, singleton keys, retry backoff |

The `createScheduler()` and `createWorker()` APIs are preserved with the same interface. A custom PGlite adapter routes DDL through `exec()` and parameterized queries through `query()` for pg-boss compatibility.

## PGlite Instance Management

PGlite cannot have two instances on the same data directory. This release fixes several connection conflicts:

- `createDatabase()` caches instances by path — calling it twice returns the same connection
- `getPgliteClient()` exported to cleanly access the PGlite instance without `(db as any).$client`
- `createApp()` passes the PGlite client directly to scheduler and worker (not the string path)
- `getOrCreatePglite()` includes `vector` and `pgcrypto` extensions

## Template Scripts

Scripts renamed to `db:*` namespace and converted to Bun-native APIs:

| Before | After |
|---|---|
| `bun run seed` | `bun run db:seed` |
| `bun run reset` | `bun run db:reset` |
| `scripts/migrate.ts` | Removed (redundant — `drizzle-kit migrate` suffices) |
| `node:child_process`, `node:fs` | `Bun.spawnSync`, `Bun.write`, `Bun.file`, `$` shell, `Bun.Glob` |

`db:reset` now runs `db:current` (SQL fixtures) before `db:push` — the nanoid function must exist before the schema references it.

## Adaptive drizzle.config.ts

The config auto-detects the driver from `DATABASE_URL`:

```typescript
const isPostgres = url.startsWith('postgres://') || url.startsWith('postgresql://');
// Postgres URL → native driver, no extensions needed
// Local path   → PGlite driver with vector + pgcrypto extensions
```

`drizzle-kit` is patched via `patchedDependencies` to accept PGlite extensions in the config. Both `drizzle-kit` and `drizzle-orm` pinned to exact versions for patch compatibility. The patch and config ship with scaffolded projects.

## Scaffolder Updates

`create-vobase` now runs `db:current` before `db:push` to install SQL fixtures (nanoid function, pgcrypto, pgvector extensions), and uses the renamed `db:seed` command.

## Deployment

- `Dockerfile` uses `bun run db:migrate` instead of a custom migrate script
- Set `DATABASE_URL` for managed Postgres in production
- Litestream removed — use your Postgres provider's built-in backups

## Biome Configuration

- Scoped to `packages/` source only (excludes `.agents/`, `poc/`, `.omc/`)
- Excludes generated files (`*.gen.ts`, `*.generated.ts`) and vendored UI components
- VCS integration enabled to respect `.gitignore`

## Removed

- `bun:sqlite` and all SQLite dialect imports
- `bunqueue` job queue
- `sqlite-vec` vector extension and `lib/sqlite-vec.ts` platform loader
- `litestream.yml` and all Litestream backup references
- `better-sqlite3` native compile stub (kept — still needed by drizzle-kit)

## Type Fixes

- WhatsApp adapter: guard for undefined media item in `sendMedia`
- Channels webhook handler: default to empty array for undefined events
- Drizzle introspection test: `'date'` → `'object date'` for timestamp dataType

## Migration Guide

This is a full database engine replacement. There is no automatic data migration.

1. Update `@vobase/core` to v0.15.0
2. Replace all `sqliteTable` with `pgTable`, update column types
3. Remove all `.get()` / `.all()` calls, add `await` to every Drizzle query
4. Replace `bunqueue` imports — `createScheduler` / `createWorker` API unchanged
5. Add SQL fixtures in `db/extensions/` (nanoid, pgcrypto, vector)
6. Rename scripts: `seed` → `db:seed`, `reset` → `db:reset`
7. Set `DATABASE_URL` in production; local dev uses PGlite automatically

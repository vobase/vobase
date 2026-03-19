# create-vobase

## 0.5.1

### Patch Changes

- [`e985f08`](https://github.com/vobase/vobase/commit/e985f08e325f6e36113f0bf287f5b6985c18d9ab) Thanks [@mdluo](https://github.com/mdluo)! - Remove unused `better-sqlite3` resolution from workspace root and drop redundant `db:current` step from scaffolder setup flow

## 0.5.0

### Minor Changes

- [`7bee4e5`](https://github.com/vobase/vobase/commit/7bee4e5bda35b6bec8e6e15ec65dabb7c27575fa) Thanks [@mdluo](https://github.com/mdluo)! - ## create-vobase

  ### Agent skills download

  Scaffolded projects now include the full vobase agent skills collection. During `bun create vobase`, skills are downloaded from the repo into `.agents/skills/` and symlinked into `.claude/skills/` so Claude Code discovers them automatically.

  ### Dynamic core schema resolution

  `drizzle.config.ts` now uses `require.resolve('@vobase/core')` to find core schema paths dynamically. This fixes `db:push` failing in scaffolded projects where core lives in `node_modules` instead of `../core`.

  ## @vobase/core (patch)

  ### Dockerfile fixes

  - Copy `patches/` and `stubs/` directories before `bun install` in both standalone and monorepo Dockerfiles — required for `patchedDependencies` and `better-sqlite3` resolution
  - Remove Litestream from monorepo Dockerfile
  - Remove `startCommand` from `railway.toml` (Dockerfile CMD handles startup)

  ### Template build fixes

  - Fix `Bun.Glob` directory scanning: pass `onlyFiles: false` to include module directories in `generate.ts`
  - Fix `ctx.user` possibly null errors: use non-null assertion in authenticated routes
  - Remove leftover `.all()` call in `channel-handler.ts`
  - Fix `JobOptions` properties: `delay` → `startAfter`, `retry`/`retries` → `retryLimit`
  - Fix `@ts-expect-error` placement for optional `@azure/msal-node` import
  - Add `postgres` dependency for `db-current.ts` production path

## 0.4.0

### Minor Changes

- [`4a7dd8e`](https://github.com/vobase/vobase/commit/4a7dd8e6a96491b851f1e88d07a983bfb2dbe04f) Thanks [@mdluo](https://github.com/mdluo)! - # PostgreSQL Migration

  ![PostgreSQL Migration](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-postgres-0.15.png)

  **BREAKING CHANGE:** Vobase now uses PostgreSQL instead of SQLite. PGlite provides zero-config embedded Postgres for local development. Production deployments use managed Postgres via `DATABASE_URL`. All SQLite dependencies, APIs, and patterns have been removed.

  ## Database Engine

  | Before                                     | After                                                   |
  | ------------------------------------------ | ------------------------------------------------------- |
  | `bun:sqlite` (synchronous)                 | PGlite local / `bun:sql` production (async)             |
  | `sqliteTable` + SQLite column types        | `pgTable` + Postgres column types                       |
  | `integer('col', { mode: 'timestamp_ms' })` | `timestamp('col', { withTimezone: true }).defaultNow()` |
  | `integer('col', { mode: 'boolean' })`      | `boolean('col')`                                        |
  | `blob('col')`                              | `bytea` or `jsonb`                                      |
  | `sqlite-vec` virtual tables                | Native `pgvector` extension                             |
  | FTS5                                       | Postgres `tsvector` / `tsquery`                         |
  | JS `nanoid()` via `$defaultFn`             | SQL `nanoid()` function via fixtures                    |
  | `.get()` for single row                    | `[0]` array access                                      |
  | `.all()` for multiple rows                 | Direct array return (removed)                           |
  | Synchronous Drizzle calls                  | `await` on every query                                  |

  The `VobaseDb` type is a single Drizzle Postgres instance — handler code never knows whether PGlite or `bun:sql` is underneath. `createDatabase()` auto-detects from the URL prefix and caches PGlite instances by path to prevent duplicate connections.

  ## Job Queue: bunqueue → pg-boss

  | Before                        | After                                          |
  | ----------------------------- | ---------------------------------------------- |
  | `bunqueue` (SQLite-backed)    | `pg-boss` (Postgres-backed)                    |
  | Separate SQLite file for jobs | Same Postgres database                         |
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

  | Before                          | After                                                           |
  | ------------------------------- | --------------------------------------------------------------- |
  | `bun run seed`                  | `bun run db:seed`                                               |
  | `bun run reset`                 | `bun run db:reset`                                              |
  | `scripts/migrate.ts`            | Removed (redundant — `drizzle-kit migrate` suffices)            |
  | `node:child_process`, `node:fs` | `Bun.spawnSync`, `Bun.write`, `Bun.file`, `$` shell, `Bun.Glob` |

  `db:reset` now runs `db:current` (SQL fixtures) before `db:push` — the nanoid function must exist before the schema references it.

  ## Adaptive drizzle.config.ts

  The config auto-detects the driver from `DATABASE_URL`:

  ```typescript
  const isPostgres =
    url.startsWith("postgres://") || url.startsWith("postgresql://");
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

## 0.3.0

### Minor Changes

- [`39d2ff1`](https://github.com/vobase/vobase/commit/39d2ff137d841090f21e585661631be581edb973) Thanks [@mdluo](https://github.com/mdluo)! - Support scaffolding into the current directory with `bunx create-vobase@latest .`, requiring a clean git working tree

## 0.2.4

### Patch Changes

- [`fc504cb`](https://github.com/vobase/vobase/commit/fc504cb37187caf1150d2e1dc781ba17f9646d7e) Thanks [@mdluo](https://github.com/mdluo)! - Fix login layout flash, first-click sign-in, and /system blank page redirect

## 0.2.3

### Patch Changes

- [`b2a205d`](https://github.com/vobase/vobase/commit/b2a205d35fc9c3c96ad4b99c532c2e44c9670ccc) Thanks [@mdluo](https://github.com/mdluo)! - Add colored output to scaffolder with green checkmarks and bold headings

## 0.2.2

### Patch Changes

- [`77016c6`](https://github.com/vobase/vobase/commit/77016c6964647e87eae5ff4bc962a0e82f5aefdb) Thanks [@mdluo](https://github.com/mdluo)! - Stub better-sqlite3 so drizzle-kit uses bun:sqlite driver; clean up seed script output

## 0.2.1

### Patch Changes

- [`eb36f3e`](https://github.com/vobase/vobase/commit/eb36f3e8b00547468e9e36a6d2bb2e0f7e12d112) Thanks [@mdluo](https://github.com/mdluo)! - Use stronger default password (Admin@vobase1) for dev admin to avoid browser warnings

## 0.2.0

### Minor Changes

- [`0ec8c7d`](https://github.com/vobase/vobase/commit/0ec8c7deade6d64bd98accde44e10498684dc4db) Thanks [@mdluo](https://github.com/mdluo)! - Rewrite scaffolder for bun-only runtime with full setup flow: resolve workspace deps, generate .env with random secret, create data dir, generate routes, and push schema to SQLite.

## 0.1.2

### Patch Changes

- [`1afa072`](https://github.com/vobase/vobase/commit/1afa072849dd12631138de075c1105015c259133) Thanks [@mdluo](https://github.com/mdluo)! - Replace workspace:\* dependencies with latest published versions when scaffolding a new project.

## 0.1.1

### Patch Changes

- [`6d3049c`](https://github.com/vobase/vobase/commit/6d3049c0cf483416187cace805ff840690ffed1f) Thanks [@mdluo](https://github.com/mdluo)! - Harden credential store encryption (scryptSync KDF, Buffer handling, ciphertext validation), fix db-migrate mkdir guard and rewrite tests with real SQLite databases, and fix create-vobase giget bundling with --packages=external.

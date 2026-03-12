# AGENTS.md

This is a vobase project. The engine is @vobase/core.

## Project Overview
- **Backend Entry**: `server.ts`
- **Business Logic**: `modules/`
- **Frontend SPA**: `src/`

## Module Convention
Each module lives in `modules/{name}/`:
- `schema.ts`: Drizzle table definitions
- `handlers.ts`: Hono route handlers
- `jobs.ts`: Background job definitions
- `pages/`: React pages (optional)
- `seed.ts`: Seed data (optional)
- `index.ts`: `defineModule({ name, schema, routes, jobs, init? })`

The `system` module is a regular user module (not built into core) with routes for health, audit log, sequences, and record audits. It uses `schema: {}` since its tables are managed by core's built-in modules.

## Key Patterns
- `getCtx(c)`: Returns `{ db, user, scheduler, storage }` from Hono context.
- `defineModule({ name, schema, routes, init? })`: Registers a module. Name must be lowercase alphanumeric + hyphens. Optional `init(ctx)` hook runs at boot.
- `defineJob('module:name', async (ctx, data) => { ... })`: Background job.
- `nextSequence(tx, 'INV')`: Returns gap-free business numbers: INV-0001, INV-0002...
- `trackChanges(tx, 'table', id, oldData, newData, userId)`: Record-level audit trail.
- `auditLog`, `recordAudits`, `sequences`: Built-in Drizzle table exports from `@vobase/core`.
- `VobaseError`: Use `notFound()`, `unauthorized()`, `validation(details)` factory functions.

## Schema Management
- `db-schemas.ts` in project root is a Node.js-compatible barrel that declares core table schemas for drizzle-kit (which runs under Node.js and cannot import `bun:sqlite`).
- `drizzle.config.ts` references both `db-schemas.ts` and `modules/*/schema.ts`.
- Keep `db-schemas.ts` in sync with core schema changes when upgrading `@vobase/core`.

## Data Conventions
- **Money**: Store as INTEGER cents (e.g., `amount_cents INTEGER NOT NULL`). Never REAL/FLOAT.
- **Timestamps**: `integer('col', { mode: 'timestamp_ms' })` in DB, UTC always. Format in frontend.
- **Status fields**: Use `status TEXT NOT NULL DEFAULT 'draft'` with explicit transition logic.
- **Cross-module references**: Use plain integer/text columns. NO `.references()` foreign keys across modules.
- **IDs**: nanoid via `nanoidPrimaryKey()` helper (default 12 chars, lowercase alphanumeric).

## Code Style
- TypeScript strict mode, no `any`.
- Biome for formatting + linting (`bun run lint`).
- Tests: `bun test` (Jest-compatible API).
- Import order: external → @vobase/core → local.
- Path aliases: `@/` → `src/`, `@modules/` → `modules/`. Use `@/components/ui/button` not `../../components/ui/button`.
- Frontend routing: `src/routes.ts` defines TanStack Router virtual routes. Module pages use `../modules/` prefix since `routesDirectory` is `./src`.

## Commands
- `bun run dev`: Starts backend (Bun --watch) + Vite frontend dev server.
- `bun run db:push`: Pushes schema to SQLite (dev). No migrations needed.
- `bun run db:generate`: Generates migration files via drizzle-kit (production).
- `bun run db:migrate`: Runs migrations against the database.
- `bun run scripts/generate.ts`: Rebuilds route tree from module definitions.
- `bun test`: Runs all tests.

See @vobase/core documentation for complete API reference.

## Upgrading from Upstream Template

Vobase projects are scaffolded from `packages/template` via `bun create vobase`. After scaffolding, the project is fully owned — there is no automatic sync. Use this procedure to pull upstream improvements.

### What to upgrade

| Layer | Source of truth | How to update |
|-------|----------------|---------------|
| `@vobase/core` engine | npm registry | `bun update @vobase/core` |
| `db-schemas.ts` | Core schema exports | Manual sync (see below) |
| Shell UI (`src/shell/`, `src/components/ui/`) | Upstream template | Diff and merge |
| System module (`modules/system/`) | Upstream template | Diff and merge |
| Config files (`vite.config.ts`, `drizzle.config.ts`, `tsconfig.json`) | Upstream template | Diff and merge |
| Custom modules (`modules/*` except system) | Your project | No action needed |

### Step-by-step

```bash
# 1. Bump @vobase/core
bun update @vobase/core

# 2. Download latest template to a temp directory for diffing
bunx giget github:vobase/vobase/packages/template /tmp/vobase-upstream --force

# 3. Diff upstream against your project
diff -rq /tmp/vobase-upstream/src/shell/ src/shell/
diff -rq /tmp/vobase-upstream/src/components/ui/ src/components/ui/
diff -rq /tmp/vobase-upstream/modules/system/ modules/system/
diff -rq /tmp/vobase-upstream/src/lib/ src/lib/
diff /tmp/vobase-upstream/db-schemas.ts db-schemas.ts
diff /tmp/vobase-upstream/drizzle.config.ts drizzle.config.ts
diff /tmp/vobase-upstream/vite.config.ts vite.config.ts
```

Review each diff. Apply changes that make sense — upstream may have new UI components, bug fixes, or convention changes.

### Critical: sync `db-schemas.ts`

`db-schemas.ts` duplicates core table schemas for drizzle-kit (which runs under Node.js and cannot import `bun:sqlite`). After upgrading `@vobase/core`, check if core added, removed, or changed any built-in table columns. If so, update `db-schemas.ts` to match, then:

```bash
# Dev: push schema changes
bun run db:push

# Production: generate and run a migration
bun run db:generate
bun run db:migrate
```

### Post-upgrade checklist

1. `bun install` — resolve any new or changed dependencies
2. `bun run scripts/generate.ts` — regenerate route tree if module pages changed
3. `bun run db:push` — sync schema to dev SQLite
4. `bun run dev` — verify app starts cleanly
5. `bun test` — run tests
6. Check browser console on key pages for runtime errors

### Safe to overwrite

These files are template infrastructure with no user customization expected. Safe to replace wholesale from upstream:
- `src/components/ui/*` (shadcn components)
- `src/lib/utils.ts`
- `scripts/generate.ts`
- `components.json`

### Never overwrite

These files contain project-specific configuration or business logic:
- `modules/*` (except `modules/system/` which can be diffed)
- `vobase.config.ts`
- `.env`
- `src/home.tsx` (likely customized)
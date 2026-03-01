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
- `index.ts`: `defineModule({ name, schema, routes, jobs })`

## Key Patterns
- `getCtx(c)`: Returns `{ db, user, scheduler, storage }` from Hono context.
- `defineModule({ name, schema, routes })`: Registers a module. Name must be lowercase alphanumeric + hyphens.
- `defineJob('module:name', async (ctx, data) => { ... })`: Background job.
- `nextSequence(tx, 'INV')`: Returns gap-free business numbers: INV-0001, INV-0002...
- `trackChanges(tx, 'table', id, oldData, newData, userId)`: Record-level audit trail.
- `VobaseError`: Use `notFound()`, `unauthorized()`, `validation(details)` factory functions.

## ERP Conventions
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

## Commands
- `bunx vobase dev`: Starts backend + Vite dev server.
- `bunx vobase migrate`: Runs drizzle-kit migrations (with auto-backup).
- `bunx vobase generate`: Regenerates `routes.ts` + system schema.
- `bun test`: Runs all tests.

See @vobase/core documentation for complete API reference.

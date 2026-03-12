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


## Agent Skills

Skills are domain-specific AI knowledge packs that teach agents conventions before they generate code.

**Discover available skills:**
```
vobase add skill --list
```

**Install a skill:**
```
vobase add skill <name>
```

Installed skills land in `.agents/skills/<name>/SKILL.md`. Load a skill in your AI tool by referencing `.agents/skills/<skill-name>/SKILL.md`.

**Available skills (core app patterns):**
- `gap-free-sequences` — Transaction-safe gap-free business number generation (INV-0001, PO-0042)
- `integer-money` — Store monetary values as integer cents; eliminate float rounding in financial code
- `status-machines` — Explicit finite state machines for document workflows (draft → sent → paid → void)

**Available skills (Singapore accounting verticals):**
- `sg-gst` — Singapore GST 9%, reverse charge, exemption handling, IRAS filing
- `sg-chart-of-accounts` — Singapore standard CoA, IRAS-aligned, GST control accounts
- `sg-invoicing` — Tax invoice fields, credit notes, InvoiceNow/Peppol readiness
- `sg-cpf` — CPF contribution rates, OW/AW ceilings, age-banded tables
- `sg-payroll` — Singapore payroll: SDL, SHG levies, payslip requirements
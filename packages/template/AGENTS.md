# Vobase Project

Engine: `@vobase/core`. Backend: `server.ts`. Modules: `modules/`. Frontend: `src/`.

## Quality Rules

Every change must be clean, type-safe, tested, and maintainable.

- End-to-end type safety is mandatory: Drizzle for queries, Zod for all handler input validation, Hono typed RPC client for API calls, TanStack Router generated routes (not manual route strings), TanStack Query for data fetching (not raw fetch)
- No `any`, no unsafe `as` casts, no `// @ts-ignore`. TypeScript strict mode.
- Every handler validates input with Zod schemas. Return errors via `notFound()`, `unauthorized()`, `validation()`, `forbidden()`, `conflict()`.
- Tests for every feature, colocated as `*.test.ts`. Run `bun test` before done.
- Biome formatting + linting. Run `bun run lint`.
- Dynamic `import()` only for: heavy optional deps (MCP SDK, AI SDK, googleapis, mammoth, etc.), config-gated features, test mocking after `vi.mock()`. Local module imports must be static.
- Frontend: use `<Link>` and `navigate()` from TanStack Router — never `<a href>` for internal routes
- Frontend components: prefer shadcn/ui → ai-elements → DiceUI → custom, in that order. See root CLAUDE.md "Component Libraries" for install commands. Each library has an agent skill (`shadcn`, `ai-elements`, `diceui`) with full component catalogs — check before building custom.
- Data tables: use DiceUI data-table (skill: `data-table`) for any non-trivial table with filtering/sorting/pagination. Supports server-side and client-side modes. Only use plain shadcn Table for simple static tables.
- AI chat UI: use ai-elements components from `src/components/ai-elements/`. 6 installed (conversation, message, prompt-input, code-block, suggestion, shimmer), 48 available. Install more: `bunx --bun ai-elements@latest add <component>`. Check `ai-elements` skill references for full catalog.
- Design mockups: use `react-components` skill + Stitch MCP for visual inspiration. Always include the Vobase design guideline in the prompt (see root CLAUDE.md "Design Mockups with Stitch"). Convert output to project component libraries, never ship raw Stitch HTML.
- Path aliases: `@/` = `src/`, `@modules/` = `modules/`
- Prefer Bun native APIs over `node:*` modules: `Bun.file()`, `Bun.write()`, `Bun.spawnSync()`, `Bun.Glob`, `$` shell. Use `node:path` and `node:fs` only when no Bun equivalent exists.
- Import order: external, then `@vobase/core`, then local

## Module Convention

Each module in `modules/{name}/`: `schema.ts` (Drizzle tables), `handlers.ts` (Hono routes), `jobs.ts` (background tasks), `pages/` (React), `seed.ts`, `index.ts` (`defineModule()`).

Name: lowercase alphanumeric + hyphens. Routes mount at `/api/{name}`.

## Data Conventions

- Money: INTEGER cents, never float
- Timestamps: `timestamp('col', { withTimezone: true }).defaultNow()`, UTC always
- Status: TEXT with explicit transition logic, not arbitrary strings
- IDs: `nanoidPrimaryKey()` (12 chars, lowercase alphanumeric)
- Cross-module refs: plain text columns, no `.references()` across modules. Intra-module (same pgSchema) refs use `.references()` with appropriate `onDelete`
- Status columns: TEXT with CHECK constraints enforcing valid values. Update both the CHECK constraint and application code when adding new status values

## Why Things Are This Way

Core identity: "AI agents need a codebase they can understand." Every convention follows from this.

- Adapters live in core, not separate packages. AI agents don't read node_modules, so separate packages don't improve readability. Revisit only if adapter count exceeds 10 or install size becomes a problem.
- No plugin system. Adapters are factory functions in config — no lifecycle hooks, no registration ceremony.
- No outbound webhooks. Vobase is code-first — outbound events are `fetch()` in job handlers. No webhook delivery system needed.
- No developer admin UI. The template UI is for end-users/clients. For dev data browsing, use `bun run db:studio`.
- SSE for server-push via LISTEN/NOTIFY. No WebSocket — no use case needs bidirectional. Modules emit NOTIFY after mutations; the core SSE endpoint streams events to browsers; `useRealtimeInvalidation()` invalidates matching TanStack Query keys automatically.
- For any new feature, ask "is this genuinely blocking someone?" Prefer direct implementations over "nice-to-have from competitor research."
- What goes in core vs template modules: core owns infrastructure primitives every app needs (auth, db, jobs, storage, audit, sequences) and adapter contracts. Template modules own business logic, UI, domain features — anything an AI agent would modify per-app (messaging threads, knowledge base, AI agents, etc.).
- AI agents use Mastra (`@mastra/core`). Tools via `createTool()` from `@mastra/core/tools`. Agents via `new Agent()` from `@mastra/core/agent`. Streaming bridged to AI SDK via `toAISdkStream` from `@mastra/ai-sdk`. Frontend stays on AI SDK `useChat` from `@ai-sdk/react`.
- This file documents core's full public API so you never need to read node_modules. Keep it accurate when core changes.

## How Core Works

Import everything from `@vobase/core`. This section documents the full public API.

### Request Context

`getCtx(c)` in any handler returns: `db` (Drizzle), `user` (AuthUser), `scheduler` (job queue), `storage` (file buckets), `channels` (messaging), `integrations` (credential vault), `http` (typed HTTP client with retries + circuit breaker).

### Auth + RBAC

better-auth sessions. User: `{ id, email, name, role, activeOrganizationId? }`. Guards: `requireRole('admin')`, `requirePermission('resource:action')`, `requireOrg()`. API key auth for MCP/programmatic access. Org support opt-in.

### Channels (messaging)

Adapters (WhatsApp, Resend, SMTP) registered at boot via config. Outbound: `ctx.channels.email.send({ to, subject, html })`, `ctx.channels.whatsapp.send({ to, text })`. Send never throws — returns `{ success, messageId, error, retryable }`. Inbound: webhooks at `/api/channels/webhook/:channel` fire events. Listen via `ctx.channels.on('message_received', handler)` in init hook. Events: `message_received`, `status_update`, `reaction`. All sends logged to `channelsLog` table.

### Storage

Virtual buckets via config. `ctx.storage.bucket('name').upload(key, data, opts)`, `.download(key)`, `.delete(key)`, `.exists(key)`, `.presign(key, opts)`, `.list(prefix, opts)`. Local or S3 adapters. Metadata in `storageObjects` table. When `storage.integrationProvider` is set and the static provider is `local`, core checks the integrations vault at boot for S3-compatible credentials (e.g. Cloudflare R2 pushed by the platform) and overrides automatically.

### Integrations

Encrypted credential vault for external services. `ctx.integrations.getActive(provider)` returns decrypted config or null (ordered by `updatedAt` desc for deterministic results). `connect(provider, config, opts)`, `disconnect(id)`, `updateConfig(id, config, opts)`. Platform configure endpoint upserts: re-calling for the same provider updates instead of duplicating. AES-256-GCM, key from `BETTER_AUTH_SECRET`.

### Module Init Hook

`init(ctx: ModuleInitContext)` runs at boot with `{ db, scheduler, http, storage, channels, integrations }`. Use for: event listeners (`ctx.channels.on`), recurring jobs (`ctx.scheduler.add`), setup logic.

### Jobs

`defineJob('module:name', async (data) => { ... })` for background work. Schedule via `ctx.scheduler.add(jobName, data, opts)`. pg-boss backed (Postgres), retries, cron, job chains. No Redis.

### Realtime (SSE)

Event-driven server-push via PostgreSQL LISTEN/NOTIFY + SSE. Modules opt in.

Server: `ctx.realtime.notify({ table: 'my-table', id?, action? }, tx?)` after mutations. With `tx`, NOTIFY fires on commit only. Without `tx`, fire-and-forget.

Client: `useRealtimeInvalidation()` hook mounted in app shell. Automatically invalidates TanStack Query keys matching the `table` field. No per-query changes needed.

Query key convention: NOTIFY payload `table` field must match the first element of the `queryKey` array (e.g., `table: 'messaging-threads'` invalidates `queryKey: ['messaging-threads', ...]`).

SSE endpoint: `GET /api/events` (authenticated, cookie-based). Returns `text/event-stream`. Events: `invalidate` (data change), `ping` (keep-alive).

### Key Exports

Helpers: `nanoidPrimaryKey()`, `nextSequence(tx, prefix)`, `trackChanges(tx, table, id, old, new, userId)`, `createHttpClient(opts)`.
Error factories: `notFound()`, `unauthorized()`, `forbidden()`, `conflict()`, `validation(details)`, `dbBusy()`.
Tables: `auditLog`, `recordAudits`, `sequences`, `storageObjects`, `channelsLog`, `channelsTemplates`, `integrationsTable`.
Auth tables: `authUser`, `authSession`, `authAccount`, `authApikey`, `authOrganization`, `authMember`. Auth table map: `authTableMap` (object passed to better-auth's drizzle adapter — renamed from `authSchema`).
PostgreSQL schemas: `authPgSchema`, `auditPgSchema`, `infraPgSchema` — pgSchema objects for core modules. Template modules define their own: `conversationsPgSchema`, `aiPgSchema`, `kbPgSchema`.
Platform: `platformAuth({ hmacSecret })` — better-auth plugin for platform OAuth callback (JWT verification, user upsert, account linking, session creation). Opt-in via `PLATFORM_HMAC_SECRET` env var.

### Config Shape

`vobase.config.ts` accepts: `database` (string), `modules` (array), `storage?` (provider + buckets + optional `integrationProvider` for vault-backed S3 override), `channels?` (whatsapp/email config), `auth?` (org enabled), `trustedOrigins?`, `http?` (timeout/retries/circuit breaker), `webhooks?` (inbound with HMAC + dedup), `mcp?` (enabled), `onProvisionChannel?` (platform channel provisioning callback).

### Schema Management

`drizzle.config.ts` points at core schemas via relative paths + your module schemas. Uses Docker Compose Postgres for local dev (same as production). Dev: `bun run db:push`. Prod: `bun run db:generate` + `bun run db:migrate`.

## Commands

`docker compose up -d` — start local Postgres (pgvector/pg17, port 5432)
`bun run dev` — backend :3000 + frontend :5173
`bun run db:push` — apply fixtures then `drizzle-kit push` (dev workflow)
`bun run db:generate` — `drizzle-kit generate` migration, prepend fixtures, reset `current.sql`
`bun run db:migrate` — `drizzle-kit migrate` (apply migrations)
`bun run db:nuke` — drop the Postgres database
`bun run db:reset` — drop + recreate database + push + seed (full local reset)
`bun run db:studio` — open Drizzle Studio
`bun run db:seed` — seed data
`bun test` — run tests

## Dev Auth

Auth uses email OTP. Dev-only `POST /api/auth/dev-login` (`{ email, name? }`) bypasses OTP — creates/finds user and sets session cookie. Used by `bun run db:seed`, E2E tests, and agent-browser automation. Not available in production.

## Deploy

Dockerfile + railway.toml included. Set `DATABASE_URL` for a managed Postgres connection in production.

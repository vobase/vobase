# Vobase Monorepo

Full-stack TypeScript framework for AI coding agents. Bun + Hono + Drizzle + PostgreSQL.

## Packages

- `@vobase/core` — runtime engine: auth, audit, sequences, integrations, storage, channels, RBAC, jobs, MCP
- `@vobase/template` — scaffolding source (private). See `packages/template/CLAUDE.md` for conventions.
- `create-vobase` — project scaffolder via `bun create vobase`

## Commands

`bun install` | `bun run dev` | `bun run build` | `bun run test` | `bun run lint` | `bun run typecheck`

## Quality Rules

Every change must be clean, high quality, and maintainable. No exceptions.

- End-to-end type safety: Drizzle for queries, Zod validation on all inputs, Hono typed RPC client, TanStack generated routes, TanStack Query (not raw fetch)
- No `any`, no `as` casts unless provably safe, no `// @ts-ignore`
- Every handler validates input with Zod. Return typed errors via `VobaseError` factories.
- Tests for every feature. Colocate tests next to implementation (`*.test.ts`).
- Zero tech debt tolerance: fix what you touch. No TODO comments without linked issues.
- Biome for formatting + linting. Run `bun run lint` before committing.
- Prefer Bun native APIs over `node:*` modules: `Bun.file()`, `Bun.write()`, `Bun.spawnSync()`, `Bun.Glob`, `$` shell. Use `node:path` and `node:fs` only when no Bun equivalent exists.
- Search existing patterns before writing new code. Mirror established naming and error handling.

## Architecture

Core ships six built-in modules (`defineBuiltinModule`, `_` prefix):
- `_auth` — better-auth + AuthAdapter contract, session middleware, RBAC (roles, orgs, API keys)
- `_audit` — audit log, record change tracking, request audit middleware
- `_sequences` — gap-free business number counters (INV-0001)
- `_integrations` — AES-256-GCM encrypted credential vault for external services
- `_storage` — virtual bucket file storage, local/S3 adapters (opt-in)
- `_channels` — multi-channel messaging: WhatsApp, Resend, SMTP adapters. Inbound webhooks + event emitter. (opt-in)
- Platform integration support: `platformAuth()` better-auth plugin for OAuth handoff, `createPlatformIntegrationsRoutes()` for provider-agnostic credential forwarding

Contracts in `src/contracts/` define boundaries: AuthAdapter, ChannelAdapter, StorageAdapter, ModuleInitContext, Permission. Modules implement against these interfaces. Unconfigured services use throw-proxies.

## Domain Concepts

- Module = business capability via `defineModule({ name, schema, routes, jobs?, pages?, seed?, init? })`
- Context = `getCtx(c)` returns `{ db, user, scheduler, storage, channels, integrations, http }`
- Init hook = `init(ctx: ModuleInitContext)` at boot with all services
- Routes mount under `/api/{module}`. MCP on `/mcp`.
- Auth = better-auth sessions + `requireRole()` / `requirePermission()` / `requireOrg()` middlewares
- Data = Drizzle + PostgreSQL, integer money, explicit status transitions, auditable mutations
- Platform = opt-in multi-tenant integration via `PLATFORM_HMAC_SECRET`. `platformAuth()` plugin handles OAuth callback (JWT verify, user upsert, account linking, session creation). `createPlatformIntegrationsRoutes()` handles `POST /:provider/configure` and `POST /token/update` with HMAC signature verification.

## Template Development

- `packages/template` is scaffolding material only — no migration history, no generated artifacts
- Dev: `bun run build --filter=@vobase/core` then `cd packages/template && docker compose up -d && bun run db:push && bun run dev`
- After core changes, rebuild before restarting
- Template modules: system (ops dashboard), knowledge-base (doc search), ai (conversations, Mastra agents, EverMemOS memory pipeline, channel replies, evals, state machine), integrations (external service credentials)
- AI agents use Mastra (`@mastra/core`). Tools via `createTool()`, agents via `new Agent()`. Streaming bridged to AI SDK via `@mastra/ai-sdk` (`toAISdkStream`). Frontend stays on AI SDK `useChat`.
- Frontend: React + TanStack Router + shadcn/ui (base-nova). Use `<Link>` not `<a href>`.

## Design Direction

Linear-inspired: clean density, information-forward, keyboard-first. Light + dark mode, neutral gray + one accent. OKLCH colors. No gradients, no glassmorphism, no decoration without purpose. shadcn/ui components are owned source — customize freely.

### Component Libraries (priority order)

1. **shadcn/ui** — standard UI primitives (Button, Card, Dialog, Table, Form, etc.). Skill: `shadcn`. Install: `bunx shadcn@latest add <component>`.
2. **ai-elements** — AI-native UI components (48 available). Skill: `ai-elements`. Install: `bunx --bun ai-elements@latest add <component>`. Installed components live in `src/components/ai-elements/` as owned source — customize freely. Currently installed: conversation, message, prompt-input, code-block, suggestion, shimmer. Many more available: tool, reasoning, sources, inline-citation, artifact, canvas, file-tree, terminal, plan, task, confirmation, attachments, audio-player, image, sandbox, web-preview, etc.
3. **DiceUI** — advanced interactions shadcn doesn't cover (combobox, tags-input, sortable, kanban, file-upload, data-table, mention, color-picker, timeline, tour, masonry, media-player, 40+ more). Skill: `diceui`. Registry configured in `components.json`. Install: `bunx shadcn@latest add "https://diceui.com/r/<component>.json"`.

4. **DiceUI data-table** — production-ready data tables with server-side filtering, sorting, pagination, and URL state via nuqs. Skill: `data-table`. Install: `bunx shadcn@latest add "https://diceui.com/r/data-table.json"`. Use for any non-trivial table — only skip for simple static tables.

Always check these libraries before writing custom components. Each has a corresponding agent skill with full component catalogs in `references/`.

### Design Mockups with Stitch

When designing new features or revamping UI, use the `react-components` skill + Google Stitch MCP (`generate_screen_from_text`) to generate visual mockups for inspiration. **Always include the design guideline in the prompt** — without it Stitch generates generic UI that won't match Vobase:

> Linear-inspired SaaS dashboard. Clean density, information-forward, keyboard-first. Neutral gray palette with one blue accent. No gradients, no glassmorphism, no decoration without purpose. Dark mode support. Use Tailwind CSS utility classes.

Stitch output is for reference only — convert to shadcn/ui + ai-elements + DiceUI components, never ship raw Stitch HTML.

## Architectural Decisions

These decisions were made deliberately. Do not revisit without discussion.

- Core identity is "AI agents need a codebase they can understand." Every decision follows from this — strict conventions, small surface area, predictable patterns.
- Adapters stay in core, not separate packages. AI agents don't read node_modules, so package boundaries don't affect readability. Separate packages only when adapter count exceeds 10 or install size becomes a real problem.
- No plugin system. Factory functions in config, not plugin objects with lifecycle hooks. We evaluated a Vite-like model and rejected it — abstractions to solve packaging problems are over-engineering.
- No outbound webhooks. Vobase is code-first for AI agents — outbound events are just `fetch()` in job handlers. Building a webhook delivery system with retry queues is unnecessary complexity.
- Docker Compose Postgres for local dev, PGlite only for tests (in-memory). PGlite data files corrupted on unclean shutdown — Docker Compose Postgres eliminates corruption and removes ~200 lines of adapter shims. `docker compose up -d` in packages/template starts a pgvector/pg17 instance.
- SSE for server-push via LISTEN/NOTIFY. No WebSocket — none of the current use cases need bidirectional communication. Modules emit NOTIFY after mutations; the core SSE endpoint streams events to connected browsers; the frontend hook invalidates matching TanStack Query keys.
- No developer admin UI. The template UI is for end-users/clients, not developers inspecting data. For dev data browsing, use `bun run db:studio` (Drizzle Studio).
- Event emitter stays channels-internal. One consumer doesn't justify a core primitive. Audit uses synchronous middleware hooks, auth uses better-auth hooks — different patterns for different reasons.
- Naming convention: "adapter" everywhere for pluggable implementations (ChannelAdapter, StorageAdapter, createLocalAdapter, createS3Adapter). Consistent across channels and storage.
- Contracts live in `src/contracts/`, not inside modules. Five of six are cross-module (AuthUser is everywhere). The directory is the scannable API surface.
- For any new feature, ask "is this genuinely blocking someone?" before building. Prefer simple, direct implementations over "nice-to-have from competitor research."
- What goes in core vs template: core owns infrastructure primitives that every app needs (auth, db, jobs, storage, audit, sequences) and adapter contracts. If an AI agent would need to modify it per-app, it belongs in template. If it's foundational plumbing, it belongs in core.
- Template CLAUDE.md documents core's full public API so agents never need to read node_modules. Keep it accurate when core changes.
- Platform auth lives inside better-auth as a plugin (`platformAuth()`), not as separate route middleware. This eliminates route ordering concerns (no need to mount before the catch-all) and uses `internalAdapter.createSession()` for native cookie signing.
- The platform configure contract is frozen V1: `POST /api/integrations/:provider/configure` with pass-through body `{ config, label?, scopes?, expiresInSeconds? }`. Core never inspects provider-specific fields — the platform (sole HMAC-signed consumer) is the trust boundary.

## Agent Defaults

- Keep changes small and local. Search patterns first.
- Run validation for touched scope (lint, tests, typecheck).
- Do not install dependencies unless explicitly requested.

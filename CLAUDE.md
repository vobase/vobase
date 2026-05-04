# Vobase Monorepo

Full-stack TypeScript framework for AI coding agents. Bun + Hono + Drizzle + PostgreSQL, with a first-class agent runtime built on `pi-agent-core` + `pi-ai`.

## Packages

- `@vobase/core` — runtime engine: `ModuleDef` contract, agent harness (frozen-snapshot wakes, steer/abort, tool budget spill, idle resumption, restart recovery), workspace primitives (materializers, RO enforcer, AGENTS.md generator, CLI verb registry), realtime (LISTEN/NOTIFY + SSE), HMAC + webhooks, jobs (pg-boss), HTTP client, audit/sequences/auth/storage/channels/integrations schemas + adapters.
- `@vobase/template` — agent-native helpdesk scaffold (private). Canonical module shape, `wake/` harness, `pi-agent-core` agent runtime. See `packages/template/CLAUDE.md` for conventions.
- `@vobase/cli` — standalone, catalog-driven CLI binary. Discovers tenant verbs at runtime via `/api/cli/verbs`; the same binary works across deployments with different module sets.
- `create-vobase` — project scaffolder via `bun create vobase`.
- `legacy/template-v1` — frozen pre-canonical template (Mastra + declarative config). Out of the workspace, pinned to `@vobase/core@0.33.0`. Do not modify.

## Commands

`bun install` | `bun run dev` | `bun run build` | `bun run test` | `bun run lint` | `bun run typecheck`

A whitelist-mode pre-commit hook gates `bun.lock` against the `workspaces` glob in root `package.json` to prevent macOS Bun from auto-discovering nested package.json files (e.g. `poc/`) and breaking Linux CI's frozen install. Enable once per clone: `git config core.hooksPath .githooks`. Manual run: `bun run check:lockfile`.

## Quality Rules

Every change must be clean, high quality, and maintainable. No exceptions.

- End-to-end type safety: Drizzle for queries, Zod validation on all inputs, Hono typed RPC client, TanStack generated routes, TanStack Query (not raw fetch).
- No `any`, no `as` casts unless provably safe, no `// @ts-ignore`.
- Every handler validates input with Zod. Return typed errors via `VobaseError` factories.
- Tests for every feature. Colocate tests next to implementation (`*.test.ts`).
- Zero tech debt tolerance: fix what you touch. No TODO comments without linked issues.
- Biome for formatting + linting. Run `bun run lint` before committing. Biome's `lineWidth` is 120 — do not hard-wrap comments, JSDoc, or markdown at 80 chars. Let prose flow; only break for paragraph boundaries, list items, or genuine readability gains.
- Dynamic `import()` only for: heavy optional deps (MCP SDK, AI SDK, googleapis, mammoth, etc.), config-gated features, test mocking. Local module imports must be static.
- Prefer Bun native APIs over `node:*` modules: `Bun.file()`, `Bun.write()`, `Bun.spawnSync()`, `Bun.Glob`, `$` shell. Use `node:path` and `node:fs` only when no Bun equivalent exists.
- Search existing patterns before writing new code. Mirror established naming and error handling.

## Architecture

### Core surface (`@vobase/core`)

Core ships **primitives**, not a fixed list of `_`-prefixed modules. Public API by area:

- **Module contract** — `ModuleDef`, `ModuleInitCtx`, `bootModules`, `sortModules`, `RoHintFn`, `AgentContributions`, `collectAgentContributions`, `collectJobs`, `collectWebRoutes`.
- **Agent harness** — `createHarness`, `HarnessHandle`, `HarnessEvent` union, `defineAgentTool`, `AgentTool`, `WakeRuntime`, `WakeScope`, frozen-snapshot tooling (`buildFrozenSnapshot`, `assertFrozenForWake`), steer queue, journal service, journaled tx, dispatch + concurrency gate, cost cap, idle resumption, restart recovery, subagent registry, turn budget, side-load collector, message history, `llmCall`.
- **Workspace** — `createWorkspace`, `MaterializerRegistry`, `WorkspaceMaterializer`, `WorkspaceMaterializerFactory`, `IndexFileBuilder`, `IndexContributor`, `defineIndexContributor`, `generateAgentsMd`, `ScopedFs`, `ReadOnlyConfig`, `buildReadOnlyConfig`, `DirtyTracker`, `snapshotFs`.
- **CLI registry** — `CliVerbRegistry`, `defineCliVerb`, `createCatalogRoute`, `createCliDispatchRoute`, `createInProcessTransport`, `createBashVobaseCommand`, `parseBashArgv`, `coerceBashArgs`, `renderBashHelp`, `renderBashResult`.
- **Adapters + contracts** — `AuthAdapter`, `ChannelAdapter`, `StorageAdapter`, `Permission`, `OrganizationContext`, `ChangePayload`. Adapter creators: `createResendAdapter`, `createSmtpAdapter`, `createWhatsAppAdapter`, `createLocalAdapter`, `createS3Adapter`.
- **Schemas** (Drizzle) — `auditLog`, `recordAudits`, `authUser`/`authSession`/`authOrganization`/etc., `channelsLog`, `channelsTemplates`, `sequences`, `storageObjects`, `webhookDedup`, `integrationsTable`, `auditPgSchema`/`authPgSchema`/`harnessPgSchema`/`infraPgSchema`, harness schemas (`activeWakes`, `agentMessages`, `conversationEvents`, `pendingApprovals`, `tenantCostDaily`, `threads`, `auditWakeMap`).
- **Declarative resources** — `defineDeclarativeResource`, `bindDeclarativeTable`, `parseFileBytes`, `serializeMarkdownFrontmatter`, `serializeYaml`.
- **HMAC + webhooks** — `signHmac`, `verifyHmacSignature`, `createWebhookRoutes`, `webhookDedup`.
- **Realtime** — `createRealtimeService`, `createNoopRealtime`, `RealtimeService`.
- **Jobs** — `defineJob`, `createWorker`, `createScheduler`, `Scheduler`, `JobOptions`.
- **HTTP** — `createHttpClient`, `CircuitBreaker`.
- **Errors** — `VobaseError`, `notFound`, `unauthorized`, `forbidden`, `validation`, `conflict`, `errorHandler`, `ERROR_CODES`.
- **DB helpers** — `createDatabase`, `nanoidPrimaryKey`, `DEFAULT_COLUMNS`, `NANOID_ALPHABET`.

There is **no `defineModule()` factory** and no `defineBuiltinModule()`. Modules are plain typed objects (`const mod: ModuleDef = { name, requires, init, web?, agent?, jobs? }`) and the template narrows the generic core types to its concrete `ScopedDb` / `RealtimeService` / `WakeContext`.

### Module shape

`ModuleDef<Db, Realtime, TCtx>` — generic over the project's database, realtime service, and wake context. Fields:

- `name: string`
- `requires?: readonly string[]` — topological order via `sortModules`
- `enabled?: (env) => boolean` — opt-out at boot
- `init(ctx: ModuleInitCtx<Db, Realtime>)` — boot hook
- `web?: { routes: { basePath, handler, requireSession? }, middlewares? }`
- `agent?: { tools?, listeners?, materializers?, sideLoad?, agentsMd?, roHints? }`
- `jobs?: JobDef[]`

`ModuleInitCtx<Db, Realtime>` provides `{ db, organizationId, jobs, realtime, cli }`. The template extends this with `auth: AuthHandle` and threads `WakeContext` as the third generic so each module's `materializers` factory receives the wake-time bag rather than `unknown`.

### Domain conventions

- Routes mount under each module's declared `basePath` (template convention: `/api/<module>`). MCP on `/mcp`. CLI catalog + dispatch on `/api/cli/*`. SSE realtime on `/api/realtime`.
- Auth = better-auth sessions + `requireRole()` / `requirePermission()` / `requireOrg()` middlewares.
- Data = Drizzle + PostgreSQL, integer money, explicit status transitions (`applyTransition` from `~/runtime`), auditable mutations.
- Realtime = `pg_notify` after commit; the frontend hook invalidates matching TanStack Query keys via `table` → first-element-of-`queryKey` mapping.
- Extensibility = core is platform-agnostic. Platform-specific code (auth plugins, push routes, refresh callbacks) lives in the template layer. Core provides generic hooks: `signHmac` for HMAC signing, and `extraPlugins` for auth plugin injection from the template's auth config.
- Cross-module callers `import` from `@modules/<name>/service/*` directly — no port shim, no plugin system. Unconfigured services use throw-proxies that produce descriptive errors if accessed.

## Template Development

- `packages/template` is scaffolding material only — no migration history, no generated artifacts.
- Dev: `cd packages/template && docker compose up -d && bun run db:reset && bun run dev`. Backend `:3001`, frontend `:5173`.
- Workspace `*` resolution links `@vobase/core` from source, so no separate core build step.
- Template modules: settings, contacts, team, drive, messaging, agents, schedules, channels (umbrella with `adapters/{web,whatsapp,...}`), changes (generic propose/decide/apply/history), system (ops dashboard).
- Each module is a thin aggregator: `module.ts` (the `ModuleDef`) over sibling files — `schema.ts`, `state.ts`, `service/`, `handlers/`, `web.ts`, `pages/`, `components/`, `hooks/`, `jobs.ts`, `agent.ts`, `tools/`, `verbs/`, `cli.ts`, `seed.ts`, `defaults/`, `skills/`. `module.ts` carries no inline tool/listener/materializer/command literals (`check:shape`).
- AI agents run on `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`. Agent surfaces are declared per-module in `agent.ts` (`tools`, `materializers`, `roHints`, `agentsMd` fragments). The harness lives at `wake/` (top-level seam, lifted out of `modules/agents/` so any module can declare agent surfaces without circular imports).
- Frontend: React + TanStack Router + shadcn/ui (base-nova) + ai-elements + DiceUI. Use `<Link>` not `<a href>`.
- Path aliases: `@modules/*` (backend + frontend), `@auth`/`@auth/*`, `~/*` (template root — `~/runtime`, `~/wake`), `@/*` (frontend `src/`), `@vobase/core`. `check:bundle` bans `src/**` imports of `~/wake/*` and `~/runtime` to prevent backend code leaking into the browser bundle.

### Template checks (CI-enforced)

- `bun run check` runs all `check:*` together: `shape`, `bundle`, `no-auto-nav-tabs`, `shadcn-overrides`.
- `check:shape` — `module.ts` is a thin aggregator (no inline tool/listener/materializer literals), single-write-path enforcement (only `messaging/service/**` writes `messages`/`conversation_events`; only `changes/service/proposals.ts` writes `change_proposals`/`change_history`).
- `check:bundle` — frontend bundle isolation; `src/**` cannot import from `~/wake/*` or `~/runtime`.
- `check:shadcn-overrides` — intentional shadcn customizations need a `// shadcn-override-ok: <reason>` marker.

## Design Direction

Clean, information-forward, keyboard-friendly UI for non-technical helpdesk staff and the customers they serve. Comfortable type scale (15px base, no sizes below 12px outside numeric badges), generous row padding, recognizable avatars on every list item. Light + dark mode, neutral gray + one accent. OKLCH colors. No gradients, no glassmorphism, no decoration without purpose. shadcn/ui components are owned source — customize freely.

### Component Libraries (priority order)

1. **shadcn/ui** — standard UI primitives (Button, Card, Dialog, Table, Form, etc.). Skill: `shadcn`. Install: `bunx shadcn@latest add <component>`.
2. **ai-elements** — AI-native UI components (48 available). Skill: `ai-elements`. Install: `bunx --bun ai-elements@latest add <component>`. Installed components live in `src/components/ai-elements/` as owned source — customize freely. Currently installed: conversation, message, prompt-input, code-block, suggestion, shimmer. Many more available: tool, reasoning, sources, inline-citation, artifact, canvas, file-tree, terminal, plan, task, confirmation, attachments, audio-player, image, sandbox, web-preview, etc.
3. **DiceUI** — advanced interactions shadcn doesn't cover (combobox, tags-input, sortable, kanban, file-upload, data-table, mention, color-picker, timeline, tour, masonry, media-player, 40+ more). Skill: `diceui`. Registry configured in `components.json`. Install: `bunx shadcn@latest add "https://diceui.com/r/<component>.json"`.
4. **DiceUI data-table** — production-ready data tables with server-side filtering, sorting, pagination, and URL state via nuqs. Skill: `data-table`. Install: `bunx shadcn@latest add "https://diceui.com/r/data-table.json"`. Use for any non-trivial table — only skip for simple static tables.

Always check these libraries before writing custom components. Each has a corresponding agent skill with full component catalogs in `references/`. **Never write custom components for functionality already covered by these registries** — search `bunx shadcn@latest search @shadcn -q ""` and `bunx shadcn@latest search @diceui -q ""` before building anything custom.

### Key Pre-built Components (use instead of custom)

- **Date/time display: `RelativeTimeCard`** (DiceUI) — use for ALL date/time rendering. Shows auto-updating relative time ("2 minutes ago") with hover card revealing full absolute date + timezone. Inherits parent font size/color. Uses `intlFormatDistance` from date-fns (i18n-safe). Never use raw `new Date().toLocaleString()`, `formatDate()`, or custom time formatting in UI — wrap with `<RelativeTimeCard date={value} />` instead.
- **Empty states: `Empty`** (shadcn) — compose with `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`. Never build custom centered icon + text empty states.
- **Stat cards: `Stat`** (DiceUI) — compose with `StatLabel`, `StatValue`, `StatDescription`, `StatIndicator`, `StatTrend`. Never build custom metric display cards.
- **Status indicators: `Status`** (DiceUI) — compose with `StatusIndicator` (animated dot) + `StatusLabel`. Variants: `default`, `success`, `error`, `warning`, `info`. Never build custom status badges or colored dots.
- **Progress: `Progress`** (shadcn) — for linear progress bars. `Gauge` (DiceUI) — for circular/radial score displays.
- **Avatar stacks: `AvatarGroup`** (DiceUI) — handles overlap masking and +N overflow automatically. Never build custom `-space-x` avatar stacking.
- **Agent/staff identity: `usePrincipalDirectory()` + `<PrincipalAvatar>`** — purple robot for agents, blue person for staff. Never render raw ids in UI.

### Design Mockups with Stitch

When designing new features or revamping UI, use the `react-components` skill + Google Stitch MCP (`generate_screen_from_text`) to generate visual mockups for inspiration. **Always include the design guideline in the prompt** — without it Stitch generates generic UI that won't match Vobase:

> Clean, information-forward SaaS dashboard for non-technical operators. 15px base type, no sizes below 12px outside numeric badges, generous row padding, avatars on every list item. Neutral gray palette with one blue accent. No gradients, no glassmorphism, no decoration without purpose. Dark mode support. Use Tailwind CSS utility classes.

Stitch output is for reference only — convert to shadcn/ui + ai-elements + DiceUI components, never ship raw Stitch HTML.

## Architectural Decisions

These decisions were made deliberately. Do not revisit without discussion.

- Core identity is "AI agents need a codebase they can understand." Every decision follows from this — strict conventions, small surface area, predictable patterns.
- Adapters stay in core, not separate packages. AI agents don't read node_modules, so package boundaries don't affect readability. Separate packages only when adapter count exceeds 10 or install size becomes a real problem.
- No plugin system. Plain `ModuleDef` objects, not plugin objects with lifecycle hooks. We evaluated a Vite-like model and rejected it — abstractions to solve packaging problems are over-engineering.
- No outbound webhooks. Vobase is code-first for AI agents — outbound events are just `fetch()` in job handlers. Building a webhook delivery system with retry queues is unnecessary complexity.
- Docker Compose Postgres for local dev. `docker compose up -d` in `packages/template` starts a pgvector/pg17 instance on `:5432`.
- SSE for server-push via LISTEN/NOTIFY. No WebSocket — none of the current use cases need bidirectional communication. Modules emit NOTIFY after mutations; the core SSE endpoint streams events to connected browsers; the frontend hook invalidates matching TanStack Query keys.
- No developer admin UI. The template UI is for end-users/clients, not developers inspecting data. For dev data browsing, use `bun run db:studio` (Drizzle Studio).
- Naming convention: "adapter" everywhere for pluggable implementations (ChannelAdapter, StorageAdapter, createLocalAdapter, createS3Adapter). Consistent across channels and storage.
- Contracts live in `src/contracts/`, not inside modules. Cross-module surfaces (AuthUser is everywhere). The directory is the scannable API surface.
- One write path per resource. Every mutation goes through that module's `service/` layer in a transaction that also appends to `conversation_events` when conversation-scoped. `check:shape` enforces this for `messages`/`conversation_events` (only `messaging/service/**`) and `change_proposals`/`change_history` (only `changes/service/proposals.ts`).
- Adapter umbrella: modules with multiple pluggable backends use `modules/<umbrella>/adapters/<name>/`, mirroring top-level module shape. `runtime/modules.ts` lists the umbrella, never adapters. Canonical: `modules/channels/`.
- Frozen-snapshot harness discipline. System prompt computed once at `agent_start`; `systemHash` identical every turn so the provider's prefix cache stays warm. Mid-wake writes surface in the next turn's side-load.
- Steer/abort lives at tool boundaries. Customer messages drain after `tool_execution_end`; supervisor + approval-resumed events hard-abort and re-wake.
- For any new feature, ask "is this genuinely blocking someone?" before building. Prefer simple, direct implementations over "nice-to-have from competitor research."
- What goes in core vs template: core owns infrastructure primitives that every app needs (module contract, agent harness, workspace, CLI registry, jobs, realtime, audit, sequences, storage, channels, auth) and adapter contracts. If an AI agent would need to modify it per-app, it belongs in template. If it's foundational plumbing, it belongs in core.
- Template CLAUDE.md documents the canonical module shape, write-path discipline, and harness invariants so agents never need to read core source. Keep it accurate when core changes.
- Core is platform-agnostic. All platform-specific code (auth plugin, push routes, refresh callback) lives in the template layer. Core provides generic extensibility: `signHmac` for HMAC signing, `extraPlugins` for auth plugin injection. Platform-specific auth plugins register via `extraPlugins` in the template's auth config.
- Workspaces glob is whitelist-only (`packages/*`). Never add globs to recover stray nested package.json files — the lockfile gate will reject them. Regenerate `bun.lock` inside a Linux Docker container if macOS Bun has polluted it: `docker run --rm -v "$PWD:/app" -w /app oven/bun:1.3.13 bun install`.

## Agent Defaults

- Keep changes small and local. Search patterns first.
- Run validation for touched scope (lint, tests, typecheck).
- Do not install dependencies unless explicitly requested.

# AGENTS.md

Vobase is a full-stack TypeScript app framework built for AI coding agents — own-the-code scaffold with Bun, Hono, Drizzle, and module-based domain code.

## Essentials

- Runtime: Bun only — no Node.js support. All packages target `bun` runtime.
- Package manager: `bun` (`packageManager: bun@1.3.10`)
- Workspace model: Bun workspaces + Turborepo (`packages/*`)
- Root commands:
  - `bun install`
  - `bun run dev`
  - `bun run build`
  - `bun run test`
  - `bun run lint`
  - `bun run typecheck`

Keep this root file small. Put detailed language rules, implementation recipes, and long workflows in linked docs (progressive disclosure).

## Monorepo Scope

| Package | Purpose |
| --- | --- |
| `@vobase/core` | Runtime engine: app wiring, built-in modules (auth, audit, sequences, credentials, storage, notify), RBAC (roles + org + API keys), ctx, jobs, MCP (CRUD tools), contracts |
| `create-vobase` | Project scaffolder (`bun create vobase my-app`) — downloads template, resolves deps, generates routes, pushes schema |
| `@vobase/template` | Scaffolding source for new projects (private, not published) |

## Architecture

### Built-in Modules

Core ships six built-in modules using `defineBuiltinModule()` (internal, `_` prefix names):

- **`_auth`** — better-auth wrapped behind `AuthAdapter` contract, session middleware, auth audit hooks, RBAC (roles, organizations, API keys via better-auth plugins)
- **`_audit`** — audit log, record audits, request audit middleware
- **`_sequences`** — gap-free sequence counters for business numbers (INV-0001, etc.)
- **`_credentials`** — encrypted credential store (opt-in via `config.credentials.enabled`)
- **`_storage`** — file storage with virtual buckets, local/S3 providers, metadata in SQLite (opt-in via `config.storage`)
- **`_notify`** — email (Resend, SMTP) and WhatsApp (WABA) channels with logging (opt-in via `config.notify`)

Built-in modules are initialized automatically by `createApp()` and receive a `ModuleInitContext` at boot.

### Config-Driven Boot

`createApp()` no longer creates tables or runs migrations. Table management is fully delegated to drizzle-kit:
- Dev: `bun run db:push` syncs schema to SQLite
- Production: `bun run db:generate` + `bun run db:migrate`

Services not yet configured (storage, notify) use `createThrowProxy<T>()` — typed placeholders that throw descriptive errors if accessed before the provider is wired up.

### Core Contracts

TypeScript interfaces define boundaries between core and pluggable providers:
- `AuthAdapter` — wraps better-auth with `getSession(headers)` and `handler(request)`. User type includes optional `activeOrganizationId` for org-enabled apps.
- `StorageProvider` — local/S3 file storage (upload, download, delete, exists, presign, list)
- `EmailProvider`, `WhatsAppProvider` — notification channels (never throw, return `{ success, messageId, error }`)
- `StorageService` — virtual bucket model: `service.bucket('avatars').upload(key, data)` with metadata tracking
- `NotifyService` — channel-based notify: `service.email.send(msg)`, `service.whatsapp.send(msg)` with logging
- `ModuleInitContext` — `{ db, scheduler, http, storage, notify }` passed to module `init` hooks

### Schema Management

- `getActiveSchemas(config)` returns merged Drizzle table definitions based on which modules are enabled. API key schema is always included. Organization schema is opt-in via `config.organization`.
- Template's `drizzle.config.ts` points directly at core's schema files via relative paths — no barrel file needed. `bunfig.toml` forces Bun runtime for all scripts, so drizzle-kit resolves `bun:sqlite` fine.

### Core Source Layout

- `src/modules/` — built-in modules (auth, audit, sequences, credentials, storage, notify)
- `src/mcp/` — MCP server and module-aware CRUD tools
- `src/infra/` — infrastructure (errors, logger, queue, jobs, http-client, circuit-breaker, webhooks, throw-proxy)
- `src/contracts/` — TypeScript interfaces (auth, module, permissions, storage, notify)
- Root `src/` files: `app.ts`, `ctx.ts`, `module.ts`, `module-registry.ts`, `schemas.ts`, `db.ts`, `index.ts`

## Stable Domain Concepts

- Module model: business capability is a module defined with `defineModule({ name, schema, routes, jobs?, pages?, seed?, init? })`.
- Module init hook: `init(ctx: ModuleInitContext)` is called at boot with db, scheduler, http, storage, notify.
- Request context: use `getCtx(c)` to access `ctx.db`, `ctx.user`, `ctx.scheduler`, `ctx.storage`, `ctx.notify`, `ctx.http`.
- Function types: use HTTP handlers for request/response logic and jobs for background execution.
- Routing model: module APIs mount under `/api/{module}`; MCP can be exposed on `/mcp`.
- Auth model: `better-auth` session-based auth with middleware-attached user context. RBAC via `requireRole()`, `requirePermission()`, `requireOrg()` middlewares. API key auth for MCP and programmatic access. Organization support opt-in via config.
- Data model: Drizzle + SQLite (`bun:sqlite`), with safe-by-default patterns (integer money, explicit status transitions, auditable mutations).
- System module: lives in template (not core) as a regular user module with routes for health, audit log, sequences.

Describe capabilities, not brittle file locations. Prefer domain language (module, handler, job, sequence, audit log, system module) over path-heavy instructions.

## Agent Workflow Defaults

- Search existing patterns before edits; mirror established naming and error handling.
- Keep changes small and local; avoid broad refactors unless required.
- Run validation for touched scope (`lint`, tests, typecheck/build when relevant).
- Do not install new dependencies or skills unless explicitly requested.

## Template Development

- `packages/template` is a workspace member for local dogfooding, but it is **only scaffolding material** — it has no migration history.
- The template must never contain generated artifacts (`migrations/`, `node_modules/`, `dist/`, `data/`, `routeTree.gen.ts`).
- To run the template locally in dev mode, use `bun run db:push` to sync the schema to SQLite — do **not** generate or run Drizzle migrations.
- When `bun create vobase` scaffolds a new project, it downloads the template via giget and runs `bun install`.
- The system module lives in `packages/template/modules/system/` as a regular user module (not in core).
- Template ships with example modules: `system` (operations dashboard, audit log), `knowledge-base` (document extraction + hybrid search), `chatbot` (AI chat with `useChat` + AI Elements, multi-provider model routing, configurable assistants with suggestions).
- Template UI uses AI Elements from `elements.ai-sdk.dev` for chat: `Conversation` (auto-scroll), `Message` + `MessageResponse` (Shiki syntax highlighting, GFM), `PromptInput`, `Shimmer` (loading), `Suggestion` (quick-start chips).
- Shell: collapsible sidebar (icon-only ↔ expanded), breadcrumbs, Cmd+K command palette, user menu in sidebar footer, mobile nav drawer, theme toggle (light/dark/system).
- Settings page at `/settings`: profile, appearance, API keys (placeholder), organization (progressive — shows when enabled).
- Auth pages use centered card layout with Vobase wordmark.
- Chatbot streaming uses `useChat` from `@ai-sdk/react` with `DefaultChatTransport`. Backend returns `toUIMessageStreamResponse()`. Multi-provider: `claude-*` → Anthropic, `gemini-*` → Google, `gpt-*` → OpenAI.
- Knowledge base module supports uploading PDF, DOCX, XLSX, PPTX, images, and HTML. Documents are extracted to Markdown (locally via unpdf/mammoth/SheetJS/officeparser, or via Gemini OCR for scanned docs), chunked, embedded, and indexed in vec0 + FTS5. Search uses Reciprocal Rank Fusion (RRF) with fast mode (vector + keyword) and deep mode (+ HyDE query expansion + LLM re-ranking). Processing is async via the job queue.
- All frontend navigation must use TanStack Router's `<Link>` and `navigate()` — never `<a href>` for internal routes. Layout routes must define `beforeLoad` redirects to their default child route.

## Template QA (Dogfooding)

### Dev Server Setup

```bash
# 1. Build core (template imports from dist)
bun run build --filter=@vobase/core

# 2. Sync schema to SQLite (no migrations in template)
cd packages/template && bun run db:push

# 3. Start dev server
bun run dev  # backend :3000, frontend :5173
```

After changes to `@vobase/core`, rebuild before restarting the dev server.

### QA Protocol

Use `dogfood` or `agent-browser` skill for browser QA.

1. Open `http://localhost:5173/`
2. Sign up a new user (or log in if user exists)
3. Navigate system pages: `/system/logs` (audit log), `/system/list` (operations)
4. Exercise module pages — verify data loads, forms submit, tables render
5. Check browser console for errors throughout

### Data Reset

Delete `packages/template/data/` and re-run `bun run db:push`.

### Post-Session Checklist

1. `bun run test` (all packages)
2. `bun run typecheck`
3. `bun run build`
4. Browser console clean on key pages

Optional deep references for workflow/tooling:

- Browser automation skill: `.agents/skills/agent-browser/SKILL.md`
- QA/dogfooding skill: `.agents/skills/dogfood/SKILL.md`
- Skill authoring workflow: `.agents/skills/skill-creator/SKILL.md`

## Design Context

### Users
Developers and small teams who use AI coding agents to build full-stack apps. They open `vobase init`, see the template, and immediately start building their domain. The UI is a tool, not a destination — it should feel fast, capable, and invisible until needed.

### Brand Personality
**Confident, pragmatic, direct.** Vobase knows what it is and doesn't apologize. No marketing fluff in the UI. Every element earns its place. The tone mirrors the README: "You own the code. You own the data. You own the infrastructure."

### Aesthetic Direction
- **Visual tone:** Clean, professional, neutral canvas. The template is a starting point, not a brand statement. Think Linear's density and taste — information-forward, keyboard-first feel, restrained use of color.
- **References:** Linear (clean density, tasteful color, fast feel).
- **Anti-references:** Generic SaaS templates (gradient heroes, stock illustrations, rounded-everything), AI-generated UI slop (cyan-on-dark, purple gradients, glassmorphism, glowing accents), Enterprise bloatware (dense nav trees, cluttered toolbars, gray-on-gray).
- **Theme:** Light + dark mode. Neutral gray palette with a single primary accent. OKLCH color model. No warm amber tones, no serif fonts, no decorative gradients.
- **Component system:** shadcn/ui with Base UI primitives (`base-nova` preset). Components managed via CLI (`bunx --bun shadcn@latest add`).

### Design Principles
1. **Earn every pixel.** No decoration without purpose. If a border, shadow, or color doesn't improve comprehension, remove it.
2. **Neutral by default.** The template is a canvas. Strong brand colors belong to the user's app, not the scaffold. Use one accent color sparingly.
3. **Density over sprawl.** Prefer compact, information-rich layouts. Whitespace should create rhythm, not fill space.
4. **Semantic over literal.** Use `bg-primary`, `text-muted-foreground` — never raw color values. The theme system handles light/dark; components should be color-agnostic.
5. **Own the components.** shadcn means the source is yours. Customize freely, but respect the Base UI primitive APIs.

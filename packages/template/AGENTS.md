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
- `getCtx(c)`: Returns `{ db, user, scheduler, storage, notify, http }` from Hono context.
- `defineModule({ name, schema, routes, init? })`: Registers a module. Name must be lowercase alphanumeric + hyphens. Optional `init(ctx)` hook runs at boot.
- `defineJob('module:name', async (data) => { ... })`: Background job. Handler receives `data: unknown` (no ctx — use module-level db ref via `setModuleDb()` in init hook).
- `nextSequence(tx, 'INV')`: Returns gap-free business numbers: INV-0001, INV-0002...
- `trackChanges(tx, 'table', id, oldData, newData, userId)`: Record-level audit trail.
- `auditLog`, `recordAudits`, `sequences`, `storageObjects`, `notifyLog`: Built-in Drizzle table exports from `@vobase/core`.
- `VobaseError`: Use `notFound()`, `unauthorized()`, `validation(details)` factory functions.
- `requireRole('admin')`: Route-level role guard middleware.
- `requirePermission('invoices:write')`: Permission-based guard (requires organization plugin enabled).
- `requireOrg()`: Requires active organization context on the user.

## Schema Management
- `drizzle.config.ts` points directly at core's schema files via relative paths (`../core/src/modules/*/schema.ts`) and your module schemas (`modules/*/schema.ts`). No barrel file needed — `bunfig.toml` forces Bun runtime for all scripts, so drizzle-kit resolves `bun:sqlite` fine.
- After upgrading `@vobase/core`, run `bun run db:push` (dev) or `bun run db:generate && bun run db:migrate` (production) to sync schema changes.

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

## Frontend Navigation
- **All internal links must use TanStack Router's `<Link>` component and `navigate()` function** — never `<a href>` for internal routes. This ensures type-checked routing against the generated route tree.
- Import `Link` and `useNavigate` from `@tanstack/react-router`.
- Layout routes (e.g., `/chatbot`, `/knowledge-base`) must define a `beforeLoad` redirect to their default child route — layout parents have no index component.
- Navigation data in `src/data/mockData.ts` must use child route paths (e.g., `/chatbot/threads` not `/chatbot`).

## Knowledge Base Module

The `knowledge-base` module provides document ingestion, extraction, chunking, embedding, and hybrid search.

### Document Extraction
- `modules/knowledge-base/lib/extract.ts` — `extractDocument(filePath, mimeType)` returns `{ text, status: 'ok'|'needs_ocr', warning? }`
- Supported formats: PDF (text + scanned), DOCX, XLSX, PPTX, images (PNG/JPG), HTML, plain text
- Local extraction: `unpdf` (PDF), `mammoth`+`turndown` (DOCX), `SheetJS` (XLSX), `officeparser` (PPTX), `turndown` (HTML)
- OCR fallback: Gemini 2.5 Flash via `@ai-sdk/google` when `GEMINI_API_KEY` is set
- Scanned PDF detection: auto-detects by measuring chars/page (threshold: 100)

### Processing Pipeline
- Upload handler writes temp file, enqueues `knowledge-base:process-document` job, returns in <100ms
- Job extracts text → `recursiveChunk()` → `embedChunks()` → inserts into kb_chunks + kb_embeddings (vec0) + kb_chunks_fts (FTS5)
- Document status: `pending` → `processing` → `ready` | `error` | `needs_ocr`

### Hybrid Search
- `hybridSearch(db, query, options)` with `mode: 'fast' | 'deep'`
- **fast** (default): RRF (k=60) merges vector similarity + FTS5 keyword. No LLM calls. Sub-300ms.
- **deep**: adds HyDE query expansion (LLM generates hypothetical answer → embed → additional vector search) + optional LLM re-ranking. Used by chatbot KB tool.
- All LLM calls in search path have try/catch with graceful degradation to fast mode.

### Environment Variables
- `OPENAI_API_KEY` — required for embeddings (text-embedding-3-small via Vercel AI SDK)
- `GEMINI_API_KEY` — optional, enables OCR for scanned PDFs and images via Gemini 2.5 Flash

## Chatbot Module

The `chatbot` module provides AI chat with streaming, tool calling, and knowledge base integration.

### Architecture
- **Backend**: `POST /threads/:id/chat` accepts `UIMessage[]` from `useChat`, returns `toUIMessageStreamResponse()`
- **Frontend**: `useChat` from `@ai-sdk/react` with `DefaultChatTransport` — handles streaming, message state, errors automatically
- **AI Elements**: `Conversation` (auto-scroll), `Message` + `MessageResponse` (Shiki highlighting, GFM), `PromptInput`, `Shimmer` (loading), `Suggestion` (quick-start chips)
- **Multi-provider**: `resolveModel()` routes `claude-*` → `@ai-sdk/anthropic`, `gemini-*` → `@ai-sdk/google`, `gpt-*` → `@ai-sdk/openai`

### Schema
- `chatAssistants`: name, model, systemPrompt, suggestions (JSON string[]), tools, kbSourceIds
- `chatThreads`: title (auto-set from first message), assistantId, userId
- `chatMessages`: role (user/assistant), content, sources (JSON), toolCalls (JSON)

### Environment Variables
- `OPENAI_API_KEY` — for GPT models and embeddings
- `ANTHROPIC_API_KEY` — for Claude models
- `GEMINI_API_KEY` — for Gemini models

## Commands
- `bun run dev`: Starts backend (Bun --watch) + Vite frontend dev server.
- `bun run db:push`: Pushes schema to SQLite (dev). No migrations needed.
- `bun run db:generate`: Generates migration files via drizzle-kit (production).
- `bun run db:migrate`: Runs migrations against the database.
- `bun run db:studio`: Opens Drizzle Studio for visual database browsing (https://local.drizzle.studio).
- `bun run scripts/generate.ts`: Rebuilds route tree from module definitions.
- `bun run seed`: Creates admin user + sample KB documents + chatbot assistants.
- `bun run reset`: Wipe database, push schema, and seed — one command for fresh start.
- `bun test`: Runs all tests.

## Deploy

The template includes Railway deployment files:
- `Dockerfile`: Multi-stage Bun build with Litestream for SQLite backup to S3.
- `railway.toml`: Build and deploy config for Railway.
- Set `LITESTREAM_*` env vars for backup. Without them, the app runs without backup.

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
- `src/data/mockData.ts` (navigation structure)
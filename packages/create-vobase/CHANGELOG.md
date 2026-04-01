# create-vobase

## 0.6.1

### Patch Changes

- [`2428946`](https://github.com/vobase/vobase/commit/24289469613dbac3a82b1927a55a0096839fbbfc) Thanks [@mdluo](https://github.com/mdluo)! - Fix PGlite vector extension support in scaffolded projects. The drizzle-kit patch that enables `extensions` passthrough was being stripped during scaffolding, causing `db:push` to fail with `"$libdir/vector": No such file or directory` on any schema using `vector()` columns (e.g. AI module embeddings).

## 0.6.0

### Minor Changes

- [`0a4eef6`](https://github.com/vobase/vobase/commit/0a4eef68c4d812f5527fa5eca4ed6e1d25c51b62) Thanks [@mdluo](https://github.com/mdluo)! - Add knip for unused code detection, clean up dead code, and upgrade dependencies

  **Knip integration:**

  - Configure knip monorepo workspaces for root, core, template, and create-vobase
  - Scaffolder generates standalone `knip.json` for projects created with `bun create vobase`

  **Dead code cleanup:**

  - Delete 19 unused files: dead barrel re-exports, orphaned chat components, duplicate sheet/controls, 6 unused hooks
  - Remove 5 unused dependencies: `@ai-sdk/anthropic`, `@radix-ui/react-dialog`, `@radix-ui/react-direction`, `@tanstack/react-virtual`, `react-markdown`
  - De-export ~30 file-local types/interfaces, delete dead functions, tag test-only exports with `@lintignore`
  - Fix PGlite test isolation with unique temp dirs

  **Notable dependency upgrades:**

  - `typescript` 5.9 → 6.0
  - `drizzle-orm` / `drizzle-kit` beta.18 → beta.19
  - `@mastra/core` 1.15 → 1.17, `@mastra/memory` 1.9 → 1.10, `@mastra/hono` 1.2 → 1.3
  - `@electric-sql/pglite` 0.4.1 → 0.4.2
  - `better-auth` 1.5.5 → 1.5.6
  - `vite` 8.0.1 → 8.0.3
  - `@biomejs/biome` 2.4.8 → 2.4.9
  - `ai` (AI SDK) 6.0.138 → 6.0.140
  - `hono` 4.12.8 → 4.12.9

## 0.5.2

### Patch Changes

- [`20061f2`](https://github.com/vobase/vobase/commit/20061f263fdf666fd20e917af66b8192436f2989) Thanks [@mdluo](https://github.com/mdluo)! - # AI Module: Mastra Integration & Memory Pipeline

  ![AI Module](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-ai-module-0.20.0.png)

  ## Mastra Agent Architecture

  Replaced the database-driven agent factory pattern with static Mastra `Agent` instances using dynamic processors. Agents are now defined as code-level singletons with runtime-resolved input/output processors for moderation and memory.

  | Component          | What Changed                                                                                             |
  | ------------------ | -------------------------------------------------------------------------------------------------------- |
  | Agent instances    | `new Agent()` from `@mastra/core/agent` with static tools                                                |
  | Dynamic processors | `resolveInputProcessors` / `resolveOutputProcessors` via Mastra's `DynamicArgument` on `requestContext`  |
  | Tools              | Static singletons (`escalateToStaffTool`, `searchKnowledgeBaseTool`) reading deps from module-level refs |
  | Mastra singleton   | `mastra.ts` — central registry for agents, tools, workflows, memory                                      |
  | PGliteStore        | Custom storage adapter wrapping PGlite for Mastra's Memory in local dev                                  |
  | MastraServer       | Mounted at `/api/mastra` inside the vobase Hono server for Studio access                                 |

  ### Predefined Model Aliases

  Replaced env-var-based model configuration (`AI_MODEL`, `AI_EMBEDDING_MODEL`) with a typed model alias map. Agents pick models directly from the map — no conversion, no runtime config.

  ```typescript
  import { models } from "../lib/models";

  export const assistantAgent = new Agent({
    model: models.claude_sonnet, // 'anthropic/claude-sonnet-4-6'
  });
  ```

  | Alias           | Model ID                        |
  | --------------- | ------------------------------- |
  | `gpt_mini`      | `openai/gpt-5-mini`             |
  | `gpt_standard`  | `openai/gpt-5.2`                |
  | `claude_haiku`  | `anthropic/claude-haiku-4-5`    |
  | `claude_sonnet` | `anthropic/claude-sonnet-4-6`   |
  | `gemini_flash`  | `google/gemini-flash-latest`    |
  | `gemini_pro`    | `google/gemini-3.1-pro-preview` |
  | `gpt_embedding` | `openai/text-embedding-3-small` |

  ## Mastra Memory for Message Storage

  Thread messages are now stored and loaded via Mastra Memory instead of a custom `msg_messages` table. The `memory-bridge.ts` module wraps the Memory API for thread lifecycle operations.

  - `agent.stream()` and `agent.generate()` receive `memory: { thread, resource }` for auto-persistence
  - `GET /threads/:id` transforms Mastra's message format (`{ content: { format: 2, parts } }`) to the frontend's `DbMessage` format
  - Seed script initializes Mastra Memory independently for the seed context (separate process from server)
  - Removed `msg_messages` table — messages live entirely in Mastra Memory storage

  ## EverMemOS Memory Pipeline

  The memory formation pipeline (boundary detection → episode extraction → fact extraction → embedding) now uses module-level dependency injection via `lib/deps.ts` instead of constructor-injected factories.

  ## Guardrails & Moderation

  Added `onBlock` callback to the moderation input processor for logging blocked content. The `moderation-logger.ts` persists blocks to the new `ai_moderation_logs` table.

  ### API Endpoints

  | Endpoint                    | Description                    |
  | --------------------------- | ------------------------------ |
  | `GET /ai/guardrails/config` | Active guardrail rules         |
  | `GET /ai/guardrails/logs`   | Paginated moderation event log |

  ## Workflow Engine

  Added durable workflow run persistence with the `ai_workflow_runs` table. Escalation and follow-up workflows use Mastra's suspend/resume pattern with database-backed state.

  ### API Endpoints

  | Endpoint                             | Description                   |
  | ------------------------------------ | ----------------------------- |
  | `GET /ai/workflows`                  | List workflow definitions     |
  | `POST /ai/workflows/:id/trigger`     | Start a workflow run          |
  | `POST /ai/workflows/runs/:id/resume` | Resume a suspended run        |
  | `GET /ai/workflows/runs`             | Paginated run history         |
  | `GET /ai/workflows/runs/:id`         | Run detail with step timeline |

  ## Memory API

  Added paginated endpoints for browsing episodes and facts with scope-based filtering and keyset pagination.

  | Endpoint                         | Description                            |
  | -------------------------------- | -------------------------------------- |
  | `GET /ai/memory/episodes`        | Paginated episodes by scope            |
  | `GET /ai/memory/facts`           | Paginated facts, filterable by episode |
  | `DELETE /ai/memory/facts/:id`    | Delete a specific fact                 |
  | `DELETE /ai/memory/episodes/:id` | Delete episode + associated facts      |

  ## Evals Pipeline

  Eval scorers (answer relevancy, faithfulness) now use the predefined model alias directly instead of reading from env-var config.

  ## Frontend

  ### Agent Pages

  - Agent detail drawer with instructions, tools, channels, suggestions, and recent threads
  - "Chat with agent" action creates a thread and navigates to it
  - Model name displayed in card badge and detail header
  - Scrollable drawer content via `overflow-hidden` on `ScrollArea`

  ### Thread Routing

  Thread ID is now part of the URL path (`/messaging/threads/:id`) instead of a search param. Split into three route files:

  - `threads.tsx` — layout with persistent sidebar + `<Outlet />`
  - `threads.index.tsx` — welcome/new-chat view with agent selector and suggestions
  - `threads.$threadId.tsx` — chat view with empty-state placeholder when no messages

  ### Memory Pages

  - Memory timeline with scope selector (contact/user)
  - Episode/fact browsing with pagination
  - Memory search view with hybrid search

  ### Guardrails Pages

  - Guardrail config display
  - Moderation log list with pagination

  ### Workflow Pages

  - Workflow run history with status badges
  - Run detail view with step timeline

  ### New Components

  - `Sheet` component from shadcn/ui for agent detail drawer

  ## Dependencies Added

  | Package        | Purpose                                       |
  | -------------- | --------------------------------------------- |
  | `@mastra/hono` | Mount MastraServer routes inside Hono         |
  | `@mastra/pg`   | PostgresStore for Mastra Memory in production |

  ## Environment Variable Changes

  - **Removed**: `AI_MODEL`, `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_DIMENSIONS` — replaced by predefined model aliases
  - **Renamed**: `GEMINI_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` — aligns with `@ai-sdk/google` convention

  ## Scaffolder (create-vobase)

  The `create-vobase` scaffolder now generates a standalone `biome.json` during project creation. The template's `biome.json` uses `extends` to reference the monorepo root config, which doesn't exist in standalone projects — the scaffolder overwrites it with a self-contained config.

  ## Test Coverage

  293 tests passing across 29 files (657 assertions). Key test areas:

  - Moderation processor with `onBlock` callback (12 tests)
  - Memory boundary detection and extraction (24 tests)
  - Messaging handler routes with Memory-based flow (14 tests)
  - AI handler endpoints for memory, guardrails, workflows (new)
  - Eval scorer initialization

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

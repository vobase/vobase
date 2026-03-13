# @vobase/core

## 0.11.0

### Minor Changes

- [`e75eb69`](https://github.com/vobase/vobase/commit/e75eb695a551479697d77a731311d118eea5e3c7) Thanks [@mdluo](https://github.com/mdluo)! - ### Breaking: `createApp()` is now async

  `createApp()` returns a `Promise` instead of a synchronous result. Update your `server.ts`:

  ```ts
  // Before
  const app = createApp({ ...config, modules });

  // After
  const app = await createApp({ ...config, modules });
  ```

  This change enables dynamic imports of bunqueue and MCP SDK, reducing cold-start overhead when these features aren't used.

  ### New: Auth schema table exports

  All auth schema tables are now exported from `@vobase/core`:

  ```ts
  import {
    authUser,
    authSession,
    authAccount,
    authVerification,
    authApikey,
    authOrganization,
    authMember,
    authInvitation,
  } from "@vobase/core";
  ```

  This eliminates the need for `db-schemas.ts` barrel files in template projects. `drizzle.config.ts` can point directly at core's schema source files — `bunfig.toml` forces Bun runtime for drizzle-kit, so `bun:sqlite` resolves natively.

  ### New: Source-first package exports

  Package exports now point to `src/index.ts` instead of `dist/`. Bun resolves TypeScript directly, removing the build step for local development. The `build` script now runs `tsc --noEmit` (typecheck only).

  ### Fix: Storage download route

  Fixed `Response` constructor in storage download route to pass `ArrayBuffer` instead of `Uint8Array` for Bun compatibility.

  ### Template: AI example modules

  The template now ships with two AI-powered example modules alongside the existing system module:

  - **Knowledge Base** — Document management with vector embeddings (sqlite-vec), chunking pipeline, hybrid search (KNN + FTS5), and connectors (web crawl, Google Drive, SharePoint)
  - **Chatbot** — AI chat with assistants and threads, streaming responses via Vercel AI SDK, tool-augmented generation with RAG from knowledge base

  Supporting infrastructure:

  - `lib/sqlite-vec.ts` — Optional vector extension loader with graceful fallback
  - `lib/ai.ts` — Vercel AI SDK provider configuration
  - `lib/schema-helpers.ts` — Shared nanoid primary key and timestamp helpers
  - SearchBar combobox component with animated placeholder text
  - Type-safe TanStack Router navigation with `beforeLoad` redirects on layout routes
  - Storage enabled with `kb-documents` and `chat-attachments` buckets
  - Credentials store enabled for API key management

## 0.10.0

### Minor Changes

- [`cc4c59e`](https://github.com/vobase/vobase/commit/cc4c59e2a5a64f5935e2ef334dacf0b8fbb94fdb) Thanks [@mdluo](https://github.com/mdluo)! - Add RBAC support with role guards, API key auth, and optional organization/team support. Reorganize core source into mcp/ and infra/ subdirectories. Add module-aware MCP CRUD tools with API key authentication. Schema tables for apikey (always), organization/member/invitation (opt-in).

  ### New features

  - **better-auth plugins**: Wire `@better-auth/api-key` (always) and `organization` (opt-in via `config.auth.organization`) plugins into the auth module
  - **RBAC middlewares**: `requireRole()`, `requirePermission()`, `requireOrg()` exported from `@vobase/core` for route-level authorization
  - **API key auth for MCP**: MCP endpoint validates API keys via `Authorization: Bearer <key>`. Discovery tools available without auth; CRUD tools require valid API key.
  - **MCP CRUD tools**: Auto-generated list/get/create/update/delete tools per module from Drizzle schema, gated on API key authentication
  - **Organization support**: Opt-in via `config.auth.organization` — adds organization, member, invitation tables
  - **Permission contracts**: `Permission` and `OrganizationContext` TypeScript interfaces

  ### Breaking changes

  - `AuthUser` and `VobaseUser` types now include optional `activeOrganizationId` field
  - `AuthModule` type now includes `verifyApiKey()` and `organizationEnabled` fields
  - `McpDeps` interface now accepts optional `verifyApiKey` and `organizationEnabled`
  - Core source files moved: `src/mcp.ts` → `src/mcp/server.ts`, `src/errors.ts` → `src/infra/errors.ts`, etc. (barrel re-exports preserve public API)
  - New peer dependency: `@better-auth/api-key@^1.5.0`

## 0.9.0

### Minor Changes

- [`ab63ba9`](https://github.com/vobase/vobase/commit/ab63ba9ac2b6842c418d4bcbf358f4cdcaea1758) Thanks [@mdluo](https://github.com/mdluo)! - Add RBAC support with role guards, API key auth, and optional organization/team support. Reorganize core source into mcp/ and infra/ subdirectories. Add module-aware MCP CRUD tools. Schema tables for apikey (always), organization/member/invitation (opt-in).

  ### New features

  - **RBAC middlewares**: `requireRole()`, `requirePermission()`, `requireOrg()` for declarative route-level authorization
  - **API key schema**: Always included in `getActiveSchemas()` for MCP and programmatic access
  - **Organization support**: Opt-in via `getActiveSchemas({ organization: true })` — adds organization, member, invitation tables
  - **MCP CRUD tools**: Auto-generated list/get/create/update/delete tools per module from Drizzle schema
  - **Permission contracts**: `Permission` and `OrganizationContext` TypeScript interfaces

  ### Breaking changes

  - `AuthUser` and `VobaseUser` types now include optional `activeOrganizationId` field
  - Core source files moved: `src/mcp.ts` → `src/mcp/server.ts`, `src/errors.ts` → `src/infra/errors.ts`, etc. (barrel re-exports preserve public API)

## 0.8.0

### Minor Changes

- [`87891b5`](https://github.com/vobase/vobase/commit/87891b52d117a20638f086df970b0f0e3b703428) Thanks [@mdluo](https://github.com/mdluo)! - Extract auth, storage, and notify into built-in modules with config-driven boot. Auth uses an `AuthAdapter` interface, storage provides a virtual bucket model (`StorageService` + `BucketHandle`) with local and S3 providers, and notify offers channel-based delivery (email via Resend/SMTP, WhatsApp via WABA) with automatic logging. Template syncs `db-schemas.ts` with new core tables and fixes pagination, login UI, and dark mode sidebar color.

## 0.7.0

### Minor Changes

- [`8c126c9`](https://github.com/vobase/vobase/commit/8c126c96b128a2a1b11d556e93ea2f11f07ef7e7) Thanks [@mdluo](https://github.com/mdluo)! - Phase 1 architecture rethink: extract built-in modules, config-driven boot, core contracts

  **Breaking changes:**

  - `ensureCoreTables()` and `runMigrations()` removed — tables are now managed by drizzle-kit
  - `createSystemModule()`, `createSystemRoutes()` removed — system module moved to template
  - `credentialsTable`, `ensureCredentialTable()` removed — use `createCredentialsModule()` with `config.credentials.enabled`
  - `auditLog`, `recordAudits`, `sequences` now exported from built-in module paths
  - `createApp()` no longer auto-creates tables or runs migrations at boot
  - Standalone `sequence.ts`, `audit.ts`, `credentials.ts` deleted — functionality moved to `modules/` subdirectories

  **New features:**

  - `defineBuiltinModule()` factory for internal `_`-prefixed modules
  - Module `init` hook: `init(ctx: ModuleInitContext)` called at boot
  - Core contracts: `StorageProvider`, `EmailProvider`, `AuthAdapter`, `ModuleInitContext`
  - `createThrowProxy<T>()` for unconfigured service placeholders
  - `getActiveSchemas()` for conditional drizzle-kit schema inclusion
  - Webhook dedup migrated from raw SQL to Drizzle ORM
  - Empty schema (`{}`) now allowed for modules without tables

  **Template changes:**

  - System module now lives in `modules/system/` as a regular user module
  - `db-schemas.ts` barrel provides core table schemas to drizzle-kit (Node.js compatible)

## 0.6.2

### Patch Changes

- [`77016c6`](https://github.com/vobase/vobase/commit/77016c6964647e87eae5ff4bc962a0e82f5aefdb) Thanks [@mdluo](https://github.com/mdluo)! - Stub better-sqlite3 so drizzle-kit uses bun:sqlite driver; clean up seed script output

## 0.6.1

### Patch Changes

- [`6d3049c`](https://github.com/vobase/vobase/commit/6d3049c0cf483416187cace805ff840690ffed1f) Thanks [@mdluo](https://github.com/mdluo)! - Harden credential store encryption (scryptSync KDF, Buffer handling, ciphertext validation), fix db-migrate mkdir guard and rewrite tests with real SQLite databases, and fix create-vobase giget bundling with --packages=external.

## 0.6.0

### Minor Changes

- [`4e46139`](https://github.com/vobase/vobase/commit/4e461395eab8add4e1a41ba9dd6c3c7de1466204) Thanks [@mdluo](https://github.com/mdluo)! - Expose `auth` option in `CreateAppConfig` to pass social providers and other auth config through to `createAuth`

## 0.5.0

### Minor Changes

- [`71cc62a`](https://github.com/vobase/vobase/commit/71cc62a55e14299e16154cb03c067b8b61bf8053) Thanks [@mdluo](https://github.com/mdluo)! - Add `socialProviders` option to `createAuth` for configuring OAuth social login providers (Google, GitHub, etc.) via better-auth

## 0.4.1

## 0.4.0

## 0.3.0

## 0.2.0

### Minor Changes

- [`bd9b3c4`](https://github.com/vobase/vobase/commit/bd9b3c4d5cf4da012ad378c03b6094a4908f2da1) Thanks [@mdluo](https://github.com/mdluo)! - Reposition vobase from ERP engine to general app framework built for AI coding agents

  - Rewrite README with new positioning: "own every line, your AI already knows how to build on it"
  - Replace ERP-specific examples with general business app examples (SaaS, internal tools, CRM, project trackers)
  - New comparison table: vs Supabase (simplicity), Pocketbase (transparency), Rails/Laravel (AI-native)
  - Remove ERP branding from all skill files, manifest, CLAUDE.md, template AGENTS.md, and CLI README
  - Reframe core skills (integer-money, status-machines, gap-free-sequences) as universal app patterns

## 0.1.10

### Patch Changes

- [`a1036b0`](https://github.com/vobase/vobase/commit/a1036b078877f9870f2e8e883d78298c9df7da76) Thanks [@mdluo](https://github.com/mdluo)! - fix: include app routes in generate, add baseURL to auth, copy .env on init

## 0.1.9

### Patch Changes

- [`1421074`](https://github.com/vobase/vobase/commit/14210745b50ba8acb8d8843deb92224eea099d5b) Thanks [@mdluo](https://github.com/mdluo)! - fix: track template src/data by scoping gitignore data/ to root only

## 0.1.8

### Patch Changes

- [`02e2604`](https://github.com/vobase/vobase/commit/02e260484fd132d2f6daec509a716f3869b5da48) Thanks [@mdluo](https://github.com/mdluo)! - fix: only skip data/dist/node_modules at root level during post-processing

## 0.1.7

### Patch Changes

- [`bf7bc85`](https://github.com/vobase/vobase/commit/bf7bc859f7dad9cdc6042228bf62ba89352d244c) Thanks [@mdluo](https://github.com/mdluo)! - feat: support `vobase init` in current directory with git-clean safety check

## 0.1.6

### Patch Changes

- [`9c1f3a2`](https://github.com/vobase/vobase/commit/9c1f3a28ffc5453045ee46bd2260db3d6cf8b970) Thanks [@mdluo](https://github.com/mdluo)! - feat: run drizzle-kit push during init for zero-config setup

## 0.1.5

### Patch Changes

- [`42b92e5`](https://github.com/vobase/vobase/commit/42b92e550482a73e8da88f1da172c103d5d9ed39) Thanks [@mdluo](https://github.com/mdluo)! - fix: remove misleading @better-auth/cli generate step from init output

## 0.1.4

### Patch Changes

- feat: fetch template from GitHub instead of bundling in npm package

## 0.1.3

### Patch Changes

- [`b59a220`](https://github.com/vobase/vobase/commit/b59a220916a9fb49c610a935342efaea55cb0708) Thanks [@mdluo](https://github.com/mdluo)! - fix: correct package.json path resolution in init command

## 0.1.2

### Patch Changes

- [`e78d5f0`](https://github.com/vobase/vobase/commit/e78d5f03799aeb49370001919334f21fa63dc374) Thanks [@mdluo](https://github.com/mdluo)! - fix: resolve workspace:\* dependency to actual version during npm publish

## 0.1.1

### Patch Changes

- Add changesets and GitHub Actions for automated npm publishing. Fix manifest path in add-skill test.

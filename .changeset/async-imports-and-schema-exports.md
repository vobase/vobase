---
"@vobase/core": minor
---

### Breaking: `createApp()` is now async

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
import { authUser, authSession, authAccount, authVerification, authApikey, authOrganization, authMember, authInvitation } from '@vobase/core';
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

---
"@vobase/core": patch
---

# HTTP Client Retry Fix & Codebase Cleanup

## HTTP Client: Body Replay on Retry

Fixed a bug where `createHttpClient` would throw "Body already used" when retrying a POST/PUT/PATCH request after a transient failure. `ReadableStream` bodies are now buffered to `ArrayBuffer` before the retry loop so they can be replayed safely.

Added `retryAllMethods` option (default `false`) to opt in to 5xx retries for non-GET methods. GET requests continue to retry by default. This prevents accidental duplicate side effects on non-idempotent endpoints while allowing callers like the WhatsApp adapter to explicitly enable retries.

```ts
const http = createHttpClient({
  retries: 3,
  retryAllMethods: true, // opt in to POST/PUT/DELETE retries on 5xx
});
```

## Template: Raw Fetch Replaced with Hono RPC Client

Replaced 10 plain `fetch()` calls across 5 template files with typed `aiClient` RPC calls from `@/lib/api-client`. Feedback mutations now use `useMutation` from TanStack Query. Fire-and-forget calls (read tracking, typing indicators) use the RPC client directly.

**Files migrated:** `use-feedback.ts`, `use-public-chat.ts`, `use-typing-indicator.ts`, `use-read-tracking.ts`, `chat.$channelRoutingId.tsx`

## Lint Warnings Resolved

Fixed all 21 pre-existing lint warnings across core and template:
- Non-null assertions replaced with optional chaining in test files
- Removed unused `afterEach` import from storage tests
- Added biome-ignore for legitimate edge cases (guaranteed non-null after create, KB batch submit)

## Dead Code Removal

Deleted 22 unused files (hooks, components, utilities, constants) and removed 18 unused dependencies from `package.json` files. Cleaned up stale knip ignore patterns and orphaned test cases.

## Test Coverage

All 31 HTTP client tests pass, including new test for POST retry with body replay verification.

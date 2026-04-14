---
"@vobase/core": patch
---

# WhatsApp Adapter Decomposition

Decomposed the monolithic `adapters/whatsapp.ts` (1287 lines, 6 concerns) into a focused `adapters/whatsapp/` directory with single-responsibility modules.

## What Changed

The single `whatsapp.ts` file has been split into 6 modules using a factory composition pattern:

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `types.ts` | ~94 | Types, error class, constants (zero dependencies) |
| `api.ts` | ~345 | `createApiClient()` factory: `transportFetch`, `graphFetch`, `downloadMedia` closures + stateless helpers |
| `templates.ts` | ~114 | `createTemplateOperations()` factory: sync, create, delete, get templates |
| `management.ts` | ~192 | `createManagementOperations()` factory: health check, webhook subscription, token status, messaging tier |
| `adapter.ts` | ~546 | Main `createWhatsAppAdapter()` factory composing all siblings + dedup state, webhook verification, send methods |
| `index.ts` | ~5 | Barrel re-exports |

`shared.ts` and test files moved into the directory with updated import paths.

## Architecture

The decomposition uses **closure-based dependency injection** — each factory receives `graphFetch` and `config` as explicit parameters rather than relying on a monolithic closure scope. The adapter factory composes them:

```typescript
const { graphFetch, downloadMedia } = createApiClient(config, httpClient);
const templateOps = createTemplateOperations(graphFetch, phoneNumberId);
const managementOps = createManagementOperations(config, graphFetch);
```

## Zero Breaking Changes

- All public exports from `@vobase/core` are unchanged
- The barrel `index.ts` provides transparent re-exports
- Test-only exports (`_chunkText`, `_ERROR_CODE_MAP`) preserved
- Resend and SMTP adapters annotated with JSDoc as outbound-only transports

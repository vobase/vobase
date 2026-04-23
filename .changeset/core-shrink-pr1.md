---
"@vobase/core": minor
---

# Shrink core: remove v1 framework scaffolding

First pass of the core/template-v2 simplification. Removes v1 framework
primitives that template-v2 never consumed, and reorganises what remains
into a flatter, more scannable shape.

Semver is **minor** because there are no external consumers (vobase only
ships new projects via `create-vobase`). Treat the list below as breaking
for anyone still depending on the removed or moved exports.

## Removed exports

The v1 module/app runtime is gone:

- `createApp`, `CreateAppConfig`
- `VobaseCtx`, `VobaseUser`, `contextMiddleware`, `getCtx`
- `defineModule`, `DefineModuleConfig`, `VobaseModule`
- `registerModules`
- `ModuleInitContext`
- `createThrowProxy`

Built-in module factories (`createAuditModule`, `createAuthModule`,
`createChannelsModule`, `createIntegrationsModule`, `createSequencesModule`,
`createStorageModule`) and their associated services, middleware,
permissions helpers (`requireRole`, `requirePermission`, `requireOrg`),
audit-hooks, integration refresh/encrypt helpers, `nextSequence`,
`trackChanges`, `requestAuditMiddleware`, and `getActiveSchemas` are
also removed. MCP CRUD generation (`src/mcp/*`) is deleted.

Schema tables (`auditLog`, `recordAudits`, `sequences`, `storageObjects`,
`channelsLog`, `channelsTemplates`, `integrationsTable`, all `auth*` tables,
`webhookDedup`) still ship from `@vobase/core`.

## Moved exports

Import sources changed, but the export names are unchanged. If you were
deep-importing (`@vobase/core/src/...`) you will need to update paths.
Barrel imports from `@vobase/core` keep working.

- `src/infra/*` → flat topic folders: `src/errors/`, `src/logger/`,
  `src/realtime/`, `src/jobs/`, `src/http/`, `src/hmac/`.
- `src/modules/*/schema.ts` → `src/schemas/*.ts` (one file per domain).
- `src/modules/storage/adapters/*` → `src/adapters/storage/*`.
- `src/modules/channels/adapters/*` → `src/adapters/channels/*`.
- `WhatsAppChannelConfig` and `WhatsAppTransportConfig` now live with the
  WhatsApp adapter (`src/adapters/channels/whatsapp/types.ts`).

## Kept

Template-v2's full import surface — `auditLog`, `sequences`, all `auth*`
tables, `logger`, `createNanoid`, `nanoidPrimaryKey` (`@vobase/core/schema`),
`signHmac`, `verifyHmacSignature`, `ChannelAdapter`, `SendResult`, plus
the adapter factories, error helpers, job/realtime services, and HTTP
client — continues to ship from the root barrel.

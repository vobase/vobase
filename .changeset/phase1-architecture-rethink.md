---
"@vobase/core": minor
---

Phase 1 architecture rethink: extract built-in modules, config-driven boot, core contracts

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

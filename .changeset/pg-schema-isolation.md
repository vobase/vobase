---
"@vobase/core": minor
---

# PostgreSQL Schema Isolation

## BREAKING CHANGES

All database tables are now isolated into per-module PostgreSQL schemas instead of using table name prefixes. Existing databases require migration.

| Schema | Tables (old → new) |
|--------|-------------------|
| `auth` | `user`, `session`, `account`, `verification`, `apikey`, `organization`, `member`, `invitation` (unchanged — already bare names) |
| `audit` | `_audit_log` → `audit_log`, `_record_audits` → `record_audits` |
| `infra` | `_sequences` → `sequences`, `_channels_log` → `channels_log`, `_channels_templates` → `channels_templates`, `_integrations` → `integrations`, `_storage_objects` → `storage_objects`, `_webhook_dedup` → `webhook_dedup` |
| `messaging` | `msg_threads` → `threads`, `msg_outbox` → `outbox`, `msg_contacts` → `contacts` |
| `ai` | `msg_mem_cells` → `mem_cells`, `msg_mem_episodes` → `mem_episodes`, `msg_mem_event_logs` → `mem_event_logs`, `ai_eval_runs` → `eval_runs`, `ai_workflow_runs` → `workflow_runs`, `ai_moderation_logs` → `moderation_logs` |
| `kb` | `kb_documents` → `documents`, `kb_chunks` → `chunks`, `kb_sources` → `sources`, `kb_sync_logs` → `sync_logs` |
| `mastra` | All `mastra_*` tables (via `schemaName: 'mastra'` in PGliteStore) |

### API Changes

- `authSchema` renamed to `authTableMap` (the plain object passed to better-auth's drizzle adapter)
- New exports from `@vobase/core`: `authPgSchema`, `auditPgSchema`, `infraPgSchema`
- All Drizzle table variable names unchanged (`authUser`, `auditLog`, `msgThreads`, etc.)

### Migration for Existing Projects

Projects created from the template need a one-time migration. For fresh projects, `bun run db:push` handles everything automatically.

```sql
-- 1. Create schemas
CREATE SCHEMA IF NOT EXISTS "auth";
CREATE SCHEMA IF NOT EXISTS "audit";
CREATE SCHEMA IF NOT EXISTS "infra";
CREATE SCHEMA IF NOT EXISTS "messaging";
CREATE SCHEMA IF NOT EXISTS "ai";
CREATE SCHEMA IF NOT EXISTS "kb";
CREATE SCHEMA IF NOT EXISTS "mastra";

-- 2. Move tables (core)
ALTER TABLE "user" SET SCHEMA "auth";
ALTER TABLE "session" SET SCHEMA "auth";
ALTER TABLE "account" SET SCHEMA "auth";
ALTER TABLE "verification" SET SCHEMA "auth";
ALTER TABLE "apikey" SET SCHEMA "auth";
ALTER TABLE "organization" SET SCHEMA "auth";
ALTER TABLE "member" SET SCHEMA "auth";
ALTER TABLE "invitation" SET SCHEMA "auth";

ALTER TABLE "_audit_log" SET SCHEMA "audit";
ALTER TABLE "_record_audits" SET SCHEMA "audit";
ALTER TABLE "audit"."_audit_log" RENAME TO "audit_log";
ALTER TABLE "audit"."_record_audits" RENAME TO "record_audits";

ALTER TABLE "_sequences" SET SCHEMA "infra";
ALTER TABLE "_channels_log" SET SCHEMA "infra";
ALTER TABLE "_channels_templates" SET SCHEMA "infra";
ALTER TABLE "_integrations" SET SCHEMA "infra";
ALTER TABLE "_storage_objects" SET SCHEMA "infra";
ALTER TABLE "_webhook_dedup" SET SCHEMA "infra";
ALTER TABLE "infra"."_sequences" RENAME TO "sequences";
ALTER TABLE "infra"."_channels_log" RENAME TO "channels_log";
ALTER TABLE "infra"."_channels_templates" RENAME TO "channels_templates";
ALTER TABLE "infra"."_integrations" RENAME TO "integrations";
ALTER TABLE "infra"."_storage_objects" RENAME TO "storage_objects";
ALTER TABLE "infra"."_webhook_dedup" RENAME TO "webhook_dedup";

-- 3. Move tables (template — adjust to your modules)
ALTER TABLE "msg_threads" SET SCHEMA "messaging";
ALTER TABLE "msg_outbox" SET SCHEMA "messaging";
ALTER TABLE "msg_contacts" SET SCHEMA "messaging";
ALTER TABLE "messaging"."msg_threads" RENAME TO "threads";
ALTER TABLE "messaging"."msg_outbox" RENAME TO "outbox";
ALTER TABLE "messaging"."msg_contacts" RENAME TO "contacts";

ALTER TABLE "msg_mem_cells" SET SCHEMA "ai";
ALTER TABLE "msg_mem_episodes" SET SCHEMA "ai";
ALTER TABLE "msg_mem_event_logs" SET SCHEMA "ai";
ALTER TABLE "ai_eval_runs" SET SCHEMA "ai";
ALTER TABLE "ai_workflow_runs" SET SCHEMA "ai";
ALTER TABLE "ai_moderation_logs" SET SCHEMA "ai";
ALTER TABLE "ai"."msg_mem_cells" RENAME TO "mem_cells";
ALTER TABLE "ai"."msg_mem_episodes" RENAME TO "mem_episodes";
ALTER TABLE "ai"."msg_mem_event_logs" RENAME TO "mem_event_logs";
ALTER TABLE "ai"."ai_eval_runs" RENAME TO "eval_runs";
ALTER TABLE "ai"."ai_workflow_runs" RENAME TO "workflow_runs";
ALTER TABLE "ai"."ai_moderation_logs" RENAME TO "moderation_logs";

ALTER TABLE "kb_documents" SET SCHEMA "kb";
ALTER TABLE "kb_chunks" SET SCHEMA "kb";
ALTER TABLE "kb_sources" SET SCHEMA "kb";
ALTER TABLE "kb_sync_logs" SET SCHEMA "kb";
ALTER TABLE "kb"."kb_documents" RENAME TO "documents";
ALTER TABLE "kb"."kb_chunks" RENAME TO "chunks";
ALTER TABLE "kb"."kb_sources" RENAME TO "sources";
ALTER TABLE "kb"."kb_sync_logs" RENAME TO "sync_logs";
```

## Schema Quality Improvements

Bundled with the schema isolation work:

- **FK indexes** on auth tables: `apikey(userId)`, `member(userId, organizationId)`, `invitation(organizationId, inviterId)`
- **Partial indexes**: `outbox_queued_idx`, `mem_cells_pending_idx`, `documents_pending_idx` — smaller and faster than full status indexes
- **Composite index**: `threads(userId, channel)` for filtered thread lookups
- **CHECK constraints**: `mem_cells`, `mem_episodes`, `mem_event_logs` require `contactId IS NOT NULL OR userId IS NOT NULL`
- **$onUpdate**: `workflow_runs.updatedAt` now auto-updates via Drizzle's `$onUpdate`
- **Extension ordering**: SQL extension files renamed with numeric prefixes (`01_pgcrypto`, `02_vector`, `03_nanoid`) to enforce deterministic load order

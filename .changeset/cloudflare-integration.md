---
"@vobase/core": minor
---

feat(core): Cloudflare integration — configure upsert, storage vault override, getActive ordering

**Configure endpoint upsert:**
- Configure handler checks for existing active platform-managed integration before inserting
- Prevents duplicate rows on re-provisioning or credential rotation
- `updateConfig()` gains `markRefreshed` option to combine two DB calls into one
- `updateConfig()` preserves existing `configExpiresAt` when `expiresAt` not provided

**Storage vault override:**
- New optional `storage.integrationProvider` field on `CreateAppConfig`
- When set and static config is local, checks integrations vault at boot for S3-compatible credentials
- Generic: template chooses provider name (e.g. `'cloudflare-r2'`), core does vault resolution
- Bucket definitions always come from static config; vault only provides connection fields
- No-op when vault is empty (falls back to static config)

**Integrations service:**
- `getActive()` now orders by `updatedAt` desc for deterministic results
- Added unique partial index: one active platform integration per provider (DB-level guard)

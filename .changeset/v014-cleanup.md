---
"@vobase/core": patch
---

# v0.14 Post-Release Cleanup

## Breaking Changes

- `StorageProvider` renamed to `StorageAdapter`
- `createLocalProvider` renamed to `createLocalAdapter`
- `createS3Provider` renamed to `createS3Adapter`
- `StorageProviderConfig`, `LocalProviderConfig`, `S3ProviderConfig` renamed to `StorageAdapterConfig`, `LocalAdapterConfig`, `S3AdapterConfig`
- `_notify` module removed (use `_channels` instead)
- `_credentials` module removed (use `_integrations` instead)

## What Changed

Cleaned up duplication and naming inconsistencies from v0.14. The `_notify` module (7 files) was fully superseded by `_channels` — three duplicated adapters and two log tables removed. The `_credentials` module (3 files) was fully superseded by `_integrations` — same encryption, richer schema.

Unified all pluggable implementation naming to "adapter": storage directory renamed from `providers/` to `adapters/`, and all interface/function names updated (`StorageProvider` → `StorageAdapter`, `createLocalProvider` → `createLocalAdapter`, etc.). Now consistent with channels (`ChannelAdapter`, `createResendAdapter`).

Relocated orphaned `middleware/audit.test.ts` to `modules/audit/middleware.test.ts`.

## Migration

Replace in your imports:
- `StorageProvider` → `StorageAdapter`
- `createLocalProvider` → `createLocalAdapter`
- `createS3Provider` → `createS3Adapter`
- `StorageProviderConfig` → `StorageAdapterConfig`
- `LocalProviderConfig` → `LocalAdapterConfig`
- `S3ProviderConfig` → `S3AdapterConfig`

If using `_notify`: switch to `_channels`. `ctx.channels.email.send()` replaces `ctx.notify.email.send()`.

---
"@vobase/core": minor
---

Add `scheduler.schedule()` / `unschedule()` API backed by pg-boss cron for persistent, idempotent, multi-instance-safe recurring jobs. Migrate integrations token refresh from `setInterval` to `schedule()`.

Harden integrations service: add `'disconnected'` to schema CHECK constraint, Zod-validate `/token/update` platform endpoint, extend `updateConfig` with `label`/`scopes` opts, throw on decrypt failure instead of returning `{}`, narrow `getActive` catch to table-missing errors only, merge `markRefreshed` into `updateConfig` to eliminate double-write, and validate `PLATFORM_TENANT_SLUG` before platform refresh fetch.

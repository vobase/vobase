---
"@vobase/template": patch
"create-vobase": patch
---

Fix: bootstrap an organization on first signup in single-org tenants.

Fresh `VOBASE_MULTI_ORG=false` tenants previously had no path to enroll the first user — `autoEnroll` early-returned when no `auth.organization` existed, so the first Google signup got an `auth.user` row but no membership and `requireOrganization` 403'd with `"user is not a member of any organization"`.

`packages/template/auth/index.ts` now bootstraps a sole org during the `user.create.after` hook when none exists. The first signup becomes `owner`; subsequent signups continue to land as `member` of that sole org. The org name and slug are read from `VITE_PLATFORM_TENANT_NAME` and `VITE_PLATFORM_TENANT_SLUG` (platform-stamped at deploy time), defaulting to `"Workspace"` / `"workspace"` if unset.

Concurrency: the slug is deterministic so the unique index on `auth.organization.slug` serializes parallel first-signups — losers catch the `23505` and re-read the winner's org. The sole-org `LIMIT 1` lookups are now `ORDER BY created_at` for stability if duplicates ever exist (e.g. legacy data, multi→single-org flip).

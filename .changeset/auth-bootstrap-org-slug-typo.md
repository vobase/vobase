---
"@vobase/template": patch
"create-vobase": patch
---

Fix: tenant bootstrap now writes the configured slug to the first organization.

`packages/template/auth/index.ts` computed `orgSlug` from `VITE_PLATFORM_TENANT_SLUG` (or default `"workspace"`) but the subsequent `authOrganization.insert` hardcoded `slug: 'workspace'` — so single-org tenants stamped a different slug at deploy time silently fell back to the default. The retry path on the `23505` (concurrent first-signup) collision still queried `slug = orgSlug`, which then failed to find the just-inserted row when the winner had inserted under `'workspace'`.

The fix passes `orgSlug` through to the insert, matching the existing retry-side lookup. The unused-variable lint (caught by `biome check`) was the trail to this; the underlying bug had been latent since the bootstrap path landed.

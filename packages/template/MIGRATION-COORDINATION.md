# Tenant↔Platform Migration Coordination

Files tagged `@contract platform-tenant-v1` define the wire contract between the tenant template and vobase-platform. When you change one of these files, a symmetric change on the platform side is usually required.

## The rule

If you modify any file in CONTRACTS.md without bumping the version exported from `contracts/version.ts`, CI (`bun run check:contract`) refuses to merge. To make a coordinated change:

1. Bump `PLATFORM_TENANT_CONTRACT_VERSION` in `contracts/version.ts` (e.g. `'v1'` → `'v2'`).
2. Open a coordinated PR pair: one in vobase template, one in vobase-platform. Both must bump version.ts in lockstep.
3. The platform-side change deploys first. Wait the bake window (24h for breaking wire changes).
4. Tenants pick up the new contract on their next deploy.

## When to bump

- New required header / body field on any outbound platform call → bump.
- HMAC signing payload format change → bump.
- Removed v0/v1 backwards-compat shim → bump.

## When NOT to bump

- Comment-only edit on a `@contract` file → no bump.
- Internal refactor that preserves the wire shape → no bump.

## Grep gate

The exact number of `@contract platform-tenant-v1` annotations should match the row count in CONTRACTS.md. Drift gets caught by `check:contract`.

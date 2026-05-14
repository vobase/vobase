---
'@vobase/template': minor
---

refactor(template): adopt platform contract v3 + runtime org-id resolution

Bumps `PLATFORM_TENANT_CONTRACT_VERSION` to `v3` and removes the hardcoded
organization-id constant that module seeds and tests relied on.

## platform contract v3

- The claim and webhook-register wire bodies no longer carry
  `channelInstanceId` or `environment`. Channel-instance identity is now
  purely tenant-side state.
- On webhook registration the platform mints an `endpointId`, which the
  tenant persists on `channel_instances.config` and encodes into the
  single-arg `/link <endpointId>` QR. The managed re-verify path refreshes
  it in place.
- `handshake.ts` claim/release calls send empty bodies; the canonical
  managed-config type gains an optional `endpointId` field.

## runtime org-id resolution

- The seed orchestrator (`scripts/seed.ts`) inserts the `auth.organization`
  row first and threads its id to every module seed, instead of each seed
  reading a compile-time constant. The id comes from `PLATFORM_TENANT_ID`
  on real deploys, or a fresh nanoid for a bare `db:reset`.
- Tests resolve the id at runtime via the new `getSeededOrgId` helper
  (earliest `auth.organization` row); live smokes use `getSmokeOrgId`,
  which also honours an optional `ORG_ID` override.

## managed-channel row UI

- Drops the redundant "Platform sandbox" mode chip for managed channels —
  the display name already states the type.
- Hides the "Open in Meta WABA Manager" action for managed channels, which
  have no tenant-accessible Meta Business surface.

# Tenant Contract Files

These files implement the tenant↔platform wire contract. Changes here usually require a coordinated change on the platform side. See [MIGRATION-COORDINATION.md](./MIGRATION-COORDINATION.md).

| File | Purpose | §-Reference | Version |
|------|---------|-------------|---------|
| `modules/integrations/service/handshake.ts` | Outbound v2 HMAC handshake to platform | §3.12 (platform proxy invariant) | v2 |
| `modules/channels/adapters/whatsapp/managed-transport.ts` | Managed WhatsApp send + inbound verifier | §10 (managed-channels) | v1 |
| `modules/integrations/service/vault.ts` | Encrypted secret storage for tenant integrations | §11 (oauth-proxy) | v2 |
| `modules/integrations/service/verify-token.ts` | JWT verifier for platform-issued integration tokens | §11 | v1 |
| `modules/channels/managed/registry.ts` | Channel-kind registry + parameterized dispatch | §4.1 | v2 |
| `modules/channels/managed/bootstrap.ts` | Registry-driven channel bootstrap | §4.1 | v2 |
| `modules/channels/adapters/whatsapp/factory.ts` | Registry-driven vault provider + rotation cache key | §4.1 | v2 |

## Env var value contracts

Outbound HMAC auth to the platform reads these Railway env vars. The platform's provisioning job stamps them and the tenant reads them at runtime; both sides must agree on the value semantics.

| Env var | Value | Read by |
|---------|-------|---------|
| `PLATFORM_TENANT_ID` | platform's `tenants.id` (12-char nanoid) — sent as `X-Tenant-Id` header on every signed outbound | `modules/channels/adapters/whatsapp/handlers/managed.ts`, `modules/channels/adapters/whatsapp/factory.ts`, `modules/team/service/staff-link-sync.ts` |
| `PLATFORM_TENANT_SLUG` (a.k.a. `VITE_PLATFORM_TENANT_SLUG`) | platform's `tenants.slug` — used for `deriveVerifyToken` (WhatsApp webhook verify token derivation, where both ends must agree on the slug) and for per-managed-channel records keyed by `tenant_slug` | `modules/channels/handlers/inbound-router.ts`, `modules/channels/adapters/whatsapp/factory.ts` (deriveVerifyToken call) |
| `PLATFORM_HMAC_SECRET` | platform's `decryptSecret(tenants.hmacSecret)` — the tenant-level secret, single value for the whole tenant (**NOT** per-environment). Used to sign every outbound platform call | `modules/integrations/service/handshake.ts` (via `signedPlatformRequest`) |
| `VITE_PLATFORM_URL` / `PLATFORM_URL` | platform base URL — must be a value the tenant's `isAllowedPlatformBaseUrl` allowlist accepts | `modules/integrations/service/handshake.ts`, `modules/channels/adapters/whatsapp/handlers/managed.ts` |

**Do not send `VITE_PLATFORM_TENANT_SLUG` as `X-Tenant-Id`.** The platform looks up tenants by `tenants.id` (nanoid). Sending the slug silently fails verification — the platform falls through to its anonymous response branch without logging, so the failure is invisible. Always use `PLATFORM_TENANT_ID` for the header.

## Changelog

### v1 → v2 (Slice 3 — notification kind landing)

- `modules/channels/managed/registry.ts`: `KINDS` gains a `notification` entry alongside `sandbox`.
- `modules/integrations/service/vault.ts`: `VaultProvider` relaxed to `string`; runtime validation via the registry.
- `modules/integrations/service/handshake.ts`: parameterized `claim(kind)`, `release(kind)`, `staffLinks.{upsert,delete,list}` replace the legacy `*Notification*` helpers.
- `modules/channels/adapters/whatsapp/factory.ts`: `loadRotation` consults the registry; new `rotationCacheKey(orgId, vaultProvider)` fixes the bare-orgId multi-provider cache-collision bug.
- `modules/channels/managed/bootstrap.ts`: `claimAndBootstrap` is registry-driven.
- New `modules/channels/handlers/inbound-router.ts` mounts `/api/channels/managed/inbound/:channelInstanceId`; dispatches via the registry's `inboundDispatch` field; staff-reply branch uses `pending-mention-pings` + operator-thread fallback per §7.8.

Platform side bumps to `'v2'` in lockstep (vobase-platform commit `9379ea9`).


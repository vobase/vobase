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

The exact number of `@contract platform-tenant-v1` annotations should match the row count in CONTRACTS.md. Drift gets caught by `check:contract`. (The annotation tag stays `v1` — `PLATFORM_TENANT_CONTRACT_VERSION` carries the wire version.)

## Cutover log

### v1 → v2 — Slice 3 (notification kind landing) — 2026-05-12

**Why:** introduces the `notification` channel kind end-to-end. Route shape, handshake helper signatures, and inbound dispatch all change in lockstep. No `'v1.1'` — wire shape changes in one step (R12).

**Pre-deploy checklist:**

1. **Duplicate-phone audit (R9 Scenario G).** Run `bun run scripts/check-staff-phone-duplicates.ts` against the live tenant DB. Exits non-zero on any duplicate `(whatsapp_phone_e164, organization_id)`. Operator deduplicates before `db:migrate`.
2. **Platform deploys first.** vobase-platform `feat/slice-3-notification-kind` (commit `9379ea9` at PR tip). Includes:
   - `lib/verify-tenant-signature.ts` reads `ROUTE_SIGNATURE_SCOPES` from `modules/managed-whatsapp/route-scopes.ts` (regex scope decision deleted).
   - New `/notification/claim`, `/notification/release`, `/staff-links` routes.
   - `managed_whatsapp_channels.kind`, `managed_whatsapp_channel_claims.kind`, new `managed_whatsapp_staff_links` table.
3. **Tenant rollout.** Tenants pick up the new template on their next deploy. `claim(kind)` / `release(kind)` / `staffLinks.*` route to the new platform endpoints.
4. **`defaultOperatorAgentId` backfill.** The new `settings.org_settings` table holds the per-org pick. Existing orgs leave it unset; inbound-router falls back to the oldest enabled `agent_definitions` row until an admin sets the picker via the settings UI (Slice 4).
5. **Reconciler enqueue.** PATCH staff phone enqueues `team:sync-staff-link` (pg-boss, retryLimit 7, retryBackoff true, singletonKey `staff-link-sync:<orgId>`). Daily cron at 03:00 UTC reconciles every org with at least one WhatsApp phone.

**Rollback:** if a tenant breaks on the new wire shape, deploy the previous tenant template — platform's `/sandbox/...` paths are unchanged so sandbox flow still works. Orphaned platform-side staff-links clear on the next reconciler tick.

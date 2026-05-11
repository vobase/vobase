---
'@vobase/core': minor
'@vobase/template': minor
'@vobase/cli': minor
'create-vobase': minor
---

# Slice 2.5 + Slice 3 — Notification kind end-to-end, registry-driven managed channels, staff-link reconciler

Lands the notification-tier work as a single coordinated drop. Wire contract bumps `v1 → v2` between the tenant template and `vobase-platform` (see `packages/template/contracts/version.ts` + `packages/template/CONTRACTS.md`). Architect-approved + deslop + post-review simplification all included.

## Highlights

- **Notification channel kind** added to the managed-channels registry alongside `sandbox` (`packages/template/modules/channels/managed/registry.ts`). Per-tenant-env cap of 1 enforced via registry, not DB (no partial unique).
- **Parameterized handshake helpers** `claim(kind)` / `release(kind)` / `staffLinks.{upsert,delete,list}` replace the ad-hoc `*Notification*` shape (`packages/template/modules/integrations/service/handshake.ts`). Single `signedPlatformRequest` consolidates the three legacy `signedPlatformPost/Delete/Get` variants.
- **`inbound-router.ts`** (142 LOC) replaces the legacy 300-LOC `notifications-inbound.ts` and the 338-LOC `whatsapp-notification.ts` from the archived stash. Dispatches via `entry.inboundDispatch` (no per-kind switch in the router); staff-reply branch does ask-staff-answer (`claimPing → addNote → existing mention fan-out`) with operator-thread fallback via `defaultOperatorAgentId` → oldest enabled `agent_definitions` row (§7.8).
- **Generic `ConnectManagedChannelSheet`** replaces the kind-specific notification sheet — typed `kind→client` mapping eliminates the prior `as unknown as Record<...>` casts.
- **Staff-link reconciler** (`packages/template/modules/team/service/staff-link-sync.ts`) — single-options API + discriminated-union result (`{ kind: 'skipped' | 'applied' }`). Parallel upserts/deletes within each job. Pg-boss job `team:sync-staff-link` (`retryLimit=7`, `retryBackoff`, `singletonKey: 'staff-link-sync:<orgId>'`, `singletonHours=1/60` for R9-E rate-limit) + daily `0 3 * * *` UTC cron fanout for orgs with any `whatsapp_phone_e164`.
- **PATCH staff phone** in `team/handlers/index.ts` now enqueues the reconciler instead of inline platform calls.
- **New tables** (auto-generated migration, gitignored per template convention): `team.pending_mention_pings`, `settings.org_settings`, `team.staff_profiles.whatsapp_phone_e164`. `integrations.secrets` CHECK constraint on `vault_provider` dropped (§4.5).
- **Pre-migration audit** script `scripts/check-staff-phone-duplicates.ts` exits non-zero on duplicate `(whatsapp_phone_e164, organization_id)` rows — R9 Scenario G mitigation.
- **Three new e2e tests**: `staff-in-two-orgs.test.ts`, `kind-aware-allocator-cap.test.ts`, `reconciler-after-platform-outage.test.ts`.

## Companion platform changes (vobase-platform, deploys in lockstep)

`PLATFORM_TENANT_CONTRACT_VERSION` bumped to `'v2'` on both sides. Platform additions (live in the separate `vobase/vobase-platform` repo):

- New `managed_whatsapp_staff_links` table + `kind` columns on `managed_whatsapp_channels` + `managed_whatsapp_channel_claims`. ADD COLUMN / CREATE TABLE only — no DROPs.
- Registry expanded with `notification` entry (`perTenantEnvCap: 1`, `challengeProtocol: 'whatsapp_notif'`).
- New `/notification/claim`, `/notification/release`, `/staff-links` routes (existing `/sandbox/...` routes unchanged).
- `lib/verify-tenant-signature.ts` reads `ROUTE_SIGNATURE_SCOPES` from `modules/managed-whatsapp/route-scopes.ts` (first-match, fail-closed) instead of the prior regex scope decision.
- `forwardToLinkedStaff` for inbound staff-reply forwarding (180 LOC, v2 HMAC, tenantEnvironments→Railway fallback).
- `findStaffLinkForInbound` JOIN-based lookup; `getNotificationPoolAvailable` parameterized via shared `poolAvailableFor` helper.
- `tx as any` casts eliminated via structural `MinimalQueryHandle` interface.
- Coordinated migration: see `vobase-platform/MIGRATION-COORDINATION.md` cutover log.

## Operator handoff

See `packages/template/MIGRATION-COORDINATION.md` for the full pre-deploy checklist:

1. Run `bun run scripts/check-staff-phone-duplicates.ts` against each tenant DB (R9-G); operator deduplicates any hits before `db:migrate`.
2. Platform deploys first.
3. Tenant template picks up the new wire contract on next deploy.
4. `defaultOperatorAgentId` left nullable for existing orgs; inbound-router falls back to oldest enabled `agent_definitions` until an admin sets the picker.

## Notes

- `@vobase/cli` and `create-vobase` bumps are coupled to `@vobase/core` per the linked-packages config; no functional changes to those packages in this slice.
- 6822 insertions / 368 deletions across 59 files in the tenant repo; 14 commits including post-architect deslop and post-review simplification.
- All grep gates clean: `defineModule`/`MANAGED_REQUIRE_SIG_V2`/`MAX_ALLOCATIONS_PER_TENANT_ENV`/inline `upsertStaffLinkOnPlatform`/`whatsapp-notification.ts`/`notifications-inbound.ts` all 0.
- Both repos' `bun run typecheck` + `bun run check` exit 0; tests baseline-equivalent (2 pre-existing throw-proxy guard fails on tenant unrelated to this slice).

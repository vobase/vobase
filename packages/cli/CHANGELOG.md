# @vobase/cli

## 0.41.0

### Minor Changes

- [`4bfa583`](https://github.com/vobase/vobase/commit/4bfa583553c50092ef7ca917059bed1d98d224af) Thanks [@mdluo](https://github.com/mdluo)! - # Slice 2.5 + Slice 3 — Notification kind end-to-end, registry-driven managed channels, staff-link reconciler

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

## 0.40.0

### Minor Changes

- [`dac00a7`](https://github.com/vobase/vobase/commit/dac00a740f88ea9058a51ae785147073807adb4b) Thanks [@mdluo](https://github.com/mdluo)! - feat(cli): local-first hybrid config lookup with `--local` flag

  `vobase` now resolves configs in the same shape as `git`/`gh`/`kubectl`: walks from `cwd` looking for `./.vobase/<name>.json`, halts at the repo root (a `.git` sibling) or `$HOME`, and falls back to `~/.vobase/<name>.json`. Closest match wins, so an agency operator can `cd client-acme && vobase ...` to target that tenant without `--config` flags.

  - `vobase auth login --local` writes to `<cwd>/.vobase/<name>.json` (0600) instead of `~/.vobase/`. Pair with a project-level `.gitignore` entry for `.vobase/` (added to template + repo root).
  - The catalog cache co-locates with whichever config was loaded (`./.vobase/foo.json` → `./.vobase/foo.cache.json`).
  - New exports: `findConfigPath`, `localConfigPath`. `loadConfig` accepts a `cwd` opt; `writeConfig` accepts `local: true` + `cwd`. `CatalogClient` accepts `configFilePath` so the cache derives from the resolved path.
  - Error message updated to surface both tiers and point at `--local`.

### Patch Changes

- [`996e675`](https://github.com/vobase/vobase/commit/996e6759ccf6df9a9b83b23cf440c43967e53a2d) Thanks [@mdluo](https://github.com/mdluo)! - fix(cli/output): honor `--no-json` by checking `flags.json === false`

  cac collapses `--json` and `--no-json` onto the same `flags.json` boolean — `--json` sets it `true`, `--no-json` sets it `false`. `shouldAutoJson` previously only checked `flags.json === true` and `flags['no-json'] === true`, so `--no-json` slipped through to the non-TTY auto-JSON fallback and emitted JSON anyway when piped. Now `flags.json === false` short-circuits to human format.

  Also fixes `renderLines` to handle single-object inputs (named-field extraction) so verbs like `messaging notes` return raw markdown under `--no-json` instead of falling through to JSON.

## 0.38.0

### Minor Changes

- [`660dc2b`](https://github.com/vobase/vobase/commit/660dc2b06d1b69488609b339bc4ea43d7937c988) Thanks [@mdluo](https://github.com/mdluo)! - CLI npm publish prep + audience-tier-filtered catalog + version-skew handshake.

  **`@vobase/cli`** — first time the npm-installed binary is safe to use against any Vobase deployment.

  - **Bun preflight** in `bin/vobase.ts` exits `127` with an install hint when invoked under non-Bun runtimes. Paired with `engines.bun: ">=1.3.13"` in `package.json` so npm/bun warn at install time. (Caveat: the friendly-hint path can't fire when imports fail to resolve — Node will die on `ERR_MODULE_NOT_FOUND` first. The `engines` field + shebang are the load-bearing guards.)
  - **Auto-JSON on non-TTY** (BREAKING for pipelines that previously parsed the human table). Precedence: `--json` > `--no-json` > `!process.stdout.isTTY`. Pipe `vobase contacts list | jq` and you get JSON. Pass `--no-json` to keep table output even when piped.
  - **Version-skew warning** — when the server advertises a newer `clientLatestVersion`, the binary prints `[vobase] WARN: vobase ${installed} is behind ${latest}; upgrade with 'bun add -g @vobase/cli'` to stderr **once per process**. No persisted state. No `clientMinVersion` hard-fail.
  - **Optional `version: 1` discriminator** in `ConfigSchema` — forward-compat marker for future schema migrations. v0 configs (no `version` field) and v1 configs both parse cleanly. No migration code, no multi-tenant rewrites — `--config <name>` already provides multi-tenancy via filename.
  - `prepublishOnly` script gates publish on `typecheck && test`. `files` array now ships `README.md` + `CHANGELOG.md`.

  **`@vobase/core`** — catalog endpoint stops leaking admin-tier verbs to non-admin callers, and surfaces a one-line server-side handshake field for older CLI binaries.

  - `CliVerbRegistry.catalogFor(tier: AudienceTier)` filters via the existing `isVerbVisible` helper and memoises one entry per tier (max 3). Cache invalidates inside `register()`. Existing `catalog()` is now a back-compat shim over `catalogFor('admin')` — same shape, same etag for that tier.
  - `createCatalogRoute` is now generic over `Env`: `createCatalogRoute<TEnv>({ registry, getAudience?: (c: Context<TEnv>) => AudienceTier, clientLatestVersion?: string })`. `getAudience` defaults to `'admin'` so existing uninstrumented callers continue to see the unfiltered catalog. `clientLatestVersion` is included in the JSON body when set, omitted otherwise — older clients ignore unknown fields.
  - Removed the separate `cachedCatalog` field; per-tier memo is the single source of truth. `list()` now caches its sorted result and clears in `register()`.

  **`@vobase/template`** — wires `getAudience` from the API-key principal's role and pins `CLI_LATEST_VERSION = '0.7.0'` at the catalog mount site. Anonymous → `'contact'`, authed non-admin → `'staff'`, `role === 'admin'` → `'admin'`. The 401 from the api-key middleware still blocks anonymous before the route handler runs; the `'contact'` fallback is defense in depth.

# create-vobase

## 0.42.1

### Patch Changes

- [`9eefb19`](https://github.com/vobase/vobase/commit/9eefb19a00207c19a77e53dd301a576eaa399ead) Thanks [@mdluo](https://github.com/mdluo)! - # Tenant deploy back-ports from `a fresh tenant`

  Three pre-existing template bugs that bricked every fresh tenant's first Railway deploy. Surfaced while bootstrapping `a fresh tenant`; fixes verified on its staging environment before being back-ported here. No tenant code is required to consume these — fresh deploys just work.

  ## Tenant template (`@vobase/template`)

  ### `scripts/db-migrate.ts` + `Dockerfile` — migrations actually run on Railway

  - `scripts/db-migrate.ts` looked for `drizzle/meta/_journal.json`, a pre-1.0 drizzle-kit path that drizzle 1.0 no longer writes (journal lives in the `__drizzle_migrations` DB table). The check always failed → silent exit 0 → preDeployCommand `bun run db:migrate` claimed success without creating any tables. Now scans for any `drizzle/<ts>_<name>/migration.sql`, matching what `db:generate` actually produces.
  - `Dockerfile` runtime stage didn't `COPY` the `drizzle/` directory, so even with correct detection the migration SQL wasn't present in the container. Added `COPY --from=build /app/drizzle ./drizzle` next to the other source dirs.

  Combined, these two make `bun run db:migrate` on Railway preDeploy actually apply committed migrations. Without them every `/api/auth/*` route 500s on the first request because `auth.user` doesn't exist yet.

  ### `modules/channels/adapters/whatsapp/*` + `modules/team/service/staff-link-sync.ts` — outbound HMAC reaches the platform

  - `handlers/managed.ts` (lines 65, 92), `factory.ts` (line 243), and `staff-link-sync.ts` (line 115) sent `VITE_PLATFORM_TENANT_SLUG` as `X-Tenant-Id`. The platform verifies by `tenants.id` (an immutable 12-char nanoid), not by slug, so verification always missed and the platform silently fell through to its anonymous `{ok: true}` response. The tenant then read that as an auth failure and returned 502 on every signed surface — `/api/channels/whatsapp/managed/availability`, sandbox claim, staff-link sync.
  - Switched all four sites to `process.env.PLATFORM_TENANT_ID`, which the platform's provisioning job already stamps alongside `PLATFORM_TENANT_SLUG`. The slug stays where it legitimately belongs: `deriveVerifyToken` (both ends of the WhatsApp webhook verify derivation must agree on the slug) and per-managed-channel records keyed by `tenant_slug`.

  ## Workspace dependencies (`@vobase/core`, `@vobase/cli`, `create-vobase`)

  - `drizzle-orm`/`drizzle-kit` aligned at `^1.0.0-rc.2` across `packages/template`, root, and `create-vobase` (`@vobase/core` was already there). Beta-era drizzle-kit produced a snapshot but never wrote `meta/_journal.json`, which is the bug that made the silent-skip path above so durable.
  - Linked-packages config bumps `@vobase/core`, `@vobase/cli`, and `create-vobase` in lockstep with the dep alignment; no functional changes in those packages.

  ## Known follow-up (not blocking this change)

  drizzle-kit `1.0.0-rc.2` generates invalid SQL for `tsvector GENERATED ALWAYS AS … STORED` columns in its `ALTER COLUMN` path, which trips `db:reset → drizzle-kit push` against `drive.chunks.tsv`. Pre-existing customType usage in `packages/template/modules/drive/schema.ts`. Tests that exercise `db:reset` are blocked on a separate fix (schema reshape or drizzle-kit patch); the deploy path here uses `db:migrate` and is unaffected.

## 0.42.0

### Minor Changes

- [`44bb9a1`](https://github.com/vobase/vobase/commit/44bb9a1af944767ca8925301b8f5e113cd200a46) Thanks [@mdluo](https://github.com/mdluo)! - # Staff WhatsApp number entry + display in the team UI

  Wires up the missing UI for Slice 3's notification-tier reconciler: the backend already accepted `staff_profiles.whatsapp_phone_e164` since US-021 and the reconciler synced it to platform staff-links, but the team UI had no way to enter or view the number.

  ## Tenant template (`@vobase/template`)

  - **`team/components/staff-form-dialog.tsx`** — new "WhatsApp number" input below Languages. Validates E.164 with leading `+` (`^\+[1-9]\d{6,14}$`) inline; empty clears the column.
  - **`team/pages/$userId.tsx`** — new "WhatsApp" row in the Profile InfoCard (monospace number or `—`); patches `whatsappPhoneE164` through to the existing `PATCH /api/team/staff/:userId` handler so the reconciler enqueue fires.
  - **`team/pages/index.tsx`** — new sortable + text-filterable "WhatsApp" column in the staff list, between Languages and Capacity.
  - **`team/hooks/use-staff.ts`** — `UpsertStaffBody` type extended with optional `whatsappPhoneE164` so the typed RPC client accepts the field.

  No backend changes — the handler, schema column, and reconciler already shipped in Slice 3.

  ## Other packages

  - `@vobase/core`, `@vobase/cli`, `create-vobase` — no functional changes; linked-packages config bumps them in lockstep with `@vobase/template`.

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

## 0.37.0

### Minor Changes

- [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9) Thanks [@mdluo](https://github.com/mdluo)! - Learning loop slice 3: `agentskills.io` skill spec + signal × scope smoke coverage.

  Aligns the learned-skill format with the public `agentskills.io` spec (frontmatter + body convention), updates the skill-emission path to write that shape, and adds smoke coverage exercising every `(signalKind, scope)` pair from the triage pipeline so the cheap-model classifier and the routing rules are tested as a matrix instead of as one happy-path scenario per signal.

- [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9) Thanks [@mdluo](https://github.com/mdluo)! - Migrate the change-proposal registry to sensitivity-driven routing.

  Replaces the binary `requiresApproval` flag with a typed `Sensitivity` enum (`'low' | 'medium' | 'high' | 'critical'`). `insertProposal` now combines the agent-supplied `confidence` with the resource's effective sensitivity (resource-level + per-scalar + per-attribute) via `effectiveSensitivity()` and routes to one of three outcomes:

  - `'drop'` — confidence below `T_REVIEW` (the trivia gate)
  - `'pending'` — middle band, lands on `/changes` for human review
  - `'auto_written'` — confidence ≥ `T_AUTO_BASE + sLevel × HEADROOM`

  The auto bar is **additive** (`T_AUTO_BASE + sLevel × HEADROOM`), not multiplicative — a `'critical'` resource raises the auto threshold but never silences high-confidence proposals into `'drop'`. Calibration knobs (`T_REVIEW=0.3`, `T_AUTO_BASE=0.7`, `SENSITIVITY_HEADROOM=0.3`) and the level→number map (`low=0.2`, `medium=0.4`, `high=0.7`, `critical=0.95`) read from env at module load.

  `MaterializerRegistration` gains optional `sensitivity`, `sensitivityForFields`, and `resolveAttributeSensitivities` fields; the five existing module registrations migrate to the new shape with their previous defaults preserved.

- [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9) Thanks [@mdluo](https://github.com/mdluo)! - Per-attribute sensitivity for tenant-defined contact fields.

  `contact_attribute_definitions` now carries a `sensitivity` column (`'low' | 'medium' | 'high' | 'critical'`, default `'medium'`), and the contacts module wires `resolveAttributeSensitivities()` into the change-proposal registration. When a `field_set` payload touches `attributes.<key>`, the resolver looks up the per-key sensitivity and the routing layer combines it with the resource baseline via `effectiveSensitivity()` — so tenants can mark `attributes.tax_id` as `critical` without core code changes, and proposals routing reflects it automatically.

  The settings UI gets a sensitivity picker on attribute definitions; the `/changes` inbox shows the effective sensitivity that drove the routing decision.

- [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9) Thanks [@mdluo](https://github.com/mdluo)! - Drive editor: render markdown frontmatter as a read-only table above the editable surface.

  `drive/components/drive-markdown-editor.tsx` now ships the GFM-table plugin set plus a frontmatter splitter that pulls leading YAML out of skill / profile markdown and renders it as a read-only `PlateStatic` table. The raw frontmatter is preserved verbatim and re-prepended on save so the on-disk YAML stays byte-stable.

  Also fixes the AGENTS.md preamble preview in `agents/components/agents-md-editor.tsx`: the editor now uses `createSlateEditor({ value })` (mutating `ed.children` after construction never propagated to the rendered tree). Collapsed view stays at `max-h-48` with the fade gradient; expanded drops the cap so the preamble flows into the parent scroll container.

  `agents/handlers/definitions.ts` awaits `materialize()` and `renderPreviewAgentsMd` so the preamble route returns the rendered markdown instead of `[object Promise]`.

- [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9) Thanks [@mdluo](https://github.com/mdluo)! - Learning loop slice 2: agent-driven learning loop with triage pipeline.

  Adds the cheap-model triage pre-filter that runs before any expensive learning operation (full distill, skill emission, memory rewrite). Triage classifies the signal, scopes it (`agent.agent_memory` / `team.staff_memory` / `contacts.contact_memory` / `agents.learned_skill`), and either drops, queues, or fans out to the matching observer. Drops never leave a row; queued candidates land in a typed table for staff visibility; auto-applied lessons go through the same `change_proposals` machinery as everything else, so confidence + sensitivity routing applies uniformly.

  Wire-up: `wake/learning/triage.ts` runs as a post-wake job, and the existing learning observers (`coaching_note`, `staff_takeover`, `coexistence_echo`, `rejection`, `learned_skill`, `contact_memory`, `staff_memory`) now consume only triage-classified candidates. New `learning_candidates` table tracks pending vs consumed rows.

### Patch Changes

- [`426cef6`](https://github.com/vobase/vobase/commit/426cef6d6153e2adbf1600dcd8ce70feb235a216) Thanks [@mdluo](https://github.com/mdluo)! - Strengthen agent prompts for `send_card` and `learned_skill` capture.

  **`MERIGPT_INSTRUCTIONS` (`modules/agents/seed.ts`)** — adds two sections derived from realistic-persona smoke findings:

  - **Reply format** rule: when the customer has 2+ options to choose, compare, confirm, or act on (plans/pricing, refund decisions, booking slots, lists of choices), prefer `send_card` over `reply`. Cards let the customer one-tap their next move; `reply` is reserved for pure acknowledgements and free-form questions. Surfaces a discipline that was previously only documented per-tool.
  - **Product / pricing / plan questions** rule: must `cat /drive/BUSINESS.md` and `cat /drive/pricing.md` before replying. The smoke caught the agent answering plan-comparison questions from memory, sometimes with stale information; this forces grounding in the canonical drive docs and pairs naturally with the new `send_card` rule.

  **`learning-candidates-sideload.ts`** — replaces the hedged "rarely the right move" wording for `agents.learned_skill` candidates with a load-bearing rule: treat the candidate body as authoritative, capture verbatim, dismissal requires an explicit reason ("duplicates X" / "contradicted by Y"), replying without acting is wrong. The prior phrasing left enough room for the agent to ignore high-confidence skill candidates entirely — observed in smoke as a reply that consulted an unrelated skill, grep'd for context, then bailed without capturing the lesson.

  After both changes the realistic-persona smoke went from 7/10 → 10/10 (with the `redeem-promo` skill captured at `auto_written` from the staff coaching note).

- [`beb2f58`](https://github.com/vobase/vobase/commit/beb2f5850d8d4cb1a28d487c41cf028f490bdb06) Thanks [@mdluo](https://github.com/mdluo)! - Fix: bootstrap an organization on first signup in single-org tenants.

  Fresh `VOBASE_MULTI_ORG=false` tenants previously had no path to enroll the first user — `autoEnroll` early-returned when no `auth.organization` existed, so the first Google signup got an `auth.user` row but no membership and `requireOrganization` 403'd with `"user is not a member of any organization"`.

  `packages/template/auth/index.ts` now bootstraps a sole org during the `user.create.after` hook when none exists. The first signup becomes `owner`; subsequent signups continue to land as `member` of that sole org. The org name and slug are read from `VITE_PLATFORM_TENANT_NAME` and `VITE_PLATFORM_TENANT_SLUG` (platform-stamped at deploy time), defaulting to `"Workspace"` / `"workspace"` if unset.

  Concurrency: the slug is deterministic so the unique index on `auth.organization.slug` serializes parallel first-signups — losers catch the `23505` and re-read the winner's org. The sole-org `LIMIT 1` lookups are now `ORDER BY created_at` for stability if duplicates ever exist (e.g. legacy data, multi→single-org flip).

- [`0949685`](https://github.com/vobase/vobase/commit/0949685201971ae5973d2f8151ba5e6a0d8763cc) Thanks [@mdluo](https://github.com/mdluo)! - Fix: tenant bootstrap now writes the configured slug to the first organization.

  `packages/template/auth/index.ts` computed `orgSlug` from `VITE_PLATFORM_TENANT_SLUG` (or default `"workspace"`) but the subsequent `authOrganization.insert` hardcoded `slug: 'workspace'` — so single-org tenants stamped a different slug at deploy time silently fell back to the default. The retry path on the `23505` (concurrent first-signup) collision still queried `slug = orgSlug`, which then failed to find the just-inserted row when the winner had inserted under `'workspace'`.

  The fix passes `orgSlug` through to the insert, matching the existing retry-side lookup. The unused-variable lint (caught by `biome check`) was the trail to this; the underlying bug had been latent since the bootstrap path landed.

- [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9) Thanks [@mdluo](https://github.com/mdluo)! - `vobase contacts propose-change`: route high-sensitivity fields to `pending` and stop leaking cross-account uniqueness.

  **Confidence default depends on principal.** Agent-origin calls without an explicit `--confidence` now default to `0.85` (was `1.0`). With `T_AUTO_BASE=0.7` + `LEVEL_HIGH=0.7` + `HEADROOM=0.3`, the high auto-bar is `0.91`, so `0.85` routes high-sensitivity fields (`email`, `phone`, `displayName`) to `pending` for staff review while leaving low/medium fields auto-applying. Manual CLI calls (`apikey`/`user` principal) keep the `1.0` default — explicit operator decisions still auto-apply unless the resource is `critical`. Agents can bypass review by passing `--confidence 0.95` when a learned skill or staff memory authorizes direct writes.

  **Unique-violation (`23505`) is now neutral.** The verb's response no longer echoes `pg.detail` (which contained the conflicting row's value, leaking that another customer in the org owns it). The error reads `"That value cannot be set on this contact. Ask the customer to verify or provide a different one."`, and the verb prompt explicitly tells the agent to treat the conflict as confidential.

  Verb prompt updated: `pending` example phrasing now lists `phone` alongside `displayName`/`email` and forbids `"done/updated/all set"` replies; `auto_applied` example shifted to `segments`.

- [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9) Thanks [@mdluo](https://github.com/mdluo)! - Fix: silent in-process DB writes after a bash tool dispatch.

  `just-bash`'s `DefenseInDepthBox.lockWellKnownSymbols()` redefines `Error.stackTraceLimit` as `writable: false` while a bash tool runs. The lock is global (not ALS-scoped), so any postgres transaction begun inside a bash-tool-dispatched verb hits `cachedError` (`postgres@3.4.9` `query.js:169`), which writes `Error.stackTraceLimit = 4` and throws `TypeError: Attempted to assign to readonly property`.

  Symptom: `vobase contacts propose-change` (and any other in-process DB write under bash) failed silently for fresh contacts, while pre-cached SQL templates kept working — making the bug look like model variance.

  Fix: `packages/template/main.ts` now pins `Error.stackTraceLimit` as `configurable: false` at process start, so just-bash's `Object.defineProperty` no-ops (caught by its own try/catch).

  Also surfaces postgres `23505` unique violations as a typed `errorCode: 'unique_conflict'` in `vobase contacts propose-change`, and fixes the rename leftover in `tests/smoke/smoke-all-triggers-live.ts` that pointed at the never-renamed `smoke-staff-note-action-live.ts`.

- [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9) Thanks [@mdluo](https://github.com/mdluo)! - Test infrastructure: consolidate the smoke runtime.

  `tests/helpers/smoke-runtime.ts` is now the single source of truth for live-smoke plumbing — `runSmoke` wrapper, single DB connection, `pollAssistantTurns` with 1s→3s exponential backoff, `pickText`/`pickToolCalls`, `SMOKE_AGENT_ID`, and `dumpConversationState`. The five standalone smokes (`smoke-{inbound,conversation,staff-note,operator-thread,heartbeat}-live.ts`) shrink from 796 LoC to 451 LoC (~43%).

  The big win is failure inspectability: a failing smoke now prints customer messages, agent text, tool calls **with arguments**, tool-result stderr, the wake's journal sequence, change proposals, and `change.*` lifecycle events — not opaque `expected 1 got 0` counts.

  Also drops the orphaned `_smoke-coach-stale.ts`, renames `smoke-wa-{echo,inbound}-live.test.ts` → `*-live.ts` so they no longer get auto-picked-up by `bun test`, fixes `pickToolCalls` to match the canonical `'toolCall'` literal (was checking the non-existent `'tool_call'`), and centralises the seed agent id.

- [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9) Thanks [@mdluo](https://github.com/mdluo)! - Rename the `supervisor` wake trigger to `staff_note`, and drop two pieces of incidental complexity.

  1. **Conceptual merge.** `SupervisorKind` (`'coaching' | 'ask_staff_answer'`) is gone — the @-mention of an agent is the only signal that fires a wake; non-mention staff notes flow through the learning-loop triage instead. This removes the classifier, the tool-stripping logic, and the conditional render text that picked between two coaching styles.
  2. **Tool `audience` field dropped.** With `SupervisorKind` gone, no caller needs lane-time tool filtering by `audience: 'customer' | 'internal'`; tool `lane` is sufficient.
  3. **AGENTS.md preamble trimmed.** Lane-aware contributors gate by `triggerKind` and stay focused — drops ~50% of the per-wake preamble bytes.

  Mechanical rename: `WakeTrigger` discriminant `'supervisor'` → `'staff_note'`, `SupervisorWakePayloadSchema` → `StaffNoteWakePayloadSchema`, `MESSAGING_SUPERVISOR_TO_WAKE_JOB` → `MESSAGING_STAFF_NOTE_TO_WAKE_JOB`, file `wake/supervisor.ts` → `wake/staff-note.ts`, smoke file `tests/smoke/smoke-supervisor-action-live.ts` → `tests/smoke/smoke-staff-note-live.ts`. Renderer cue strengthened to clear assignee vs peer-consultation guidance.

  Also adds a path-leak prohibition to `messaging/tools/reply.ts`: customer replies must never cite virtual-FS paths (`/drive/...`, `/contacts/...`, `MEMORY.md`, etc.) or internal ids. Seeds dev WhatsApp placeholder credentials in `modules/contacts/seed.ts` so the adapter Zod validation passes for staff-reply paths in dev.

- [`e3b9a8b`](https://github.com/vobase/vobase/commit/e3b9a8b326f936421bfde74cd7f66e1ddaca4eb5) Thanks [@mdluo](https://github.com/mdluo)! - Add two CI lint rules at CLI verb boundaries.

  `check:trust-defaults` (`scripts/check-trust-defaults.ts`) — scans every file under `modules/` for trust-bearing input fields (`confidence`, `severity`, `priority`, `sensitivity`, `autoApply` / `auto_apply`) declared with literal `.default(...)` values in their Zod schema. Trust levels must be derived in the verb body from `ctx.principal` (see the `effectiveConfidence` pattern in `modules/contacts/cli.ts`), not baked into the schema. Closes the bug class behind the phone-hallucination from 2026-05 — a verb's `confidence: z.number().default(1.0)` quietly set `1.0` for every agent-origin call, exceeding the auto-bar for high-sensitivity fields and auto-writing fabricated values.

  `check:error-shape` (`scripts/check-error-shape.ts`) — scans `cli.ts` and `verbs/**/*.ts` for `error:` properties whose values include `cause.detail`, `cause.message`, `pg.detail`, or `pg.message`, and `data:` properties that pass the bare `cause` / `pg` identifier (or spread it). Closes the bug class behind the cross-account leak from 2026-05 where a verb forwarded raw 23505 `cause.detail` (which contains the conflicting row's primary-key tuple, including `organization_id`) into the agent-visible `error:` string — disclosing existence of another tenant's contact.

  Both rules wire into the existing `check:*` aggregator (`bun run check`); CI picks them up via the `conc bun:check:*` glob.

## 0.6.2

### Patch Changes

- [`91e5b70`](https://github.com/vobase/vobase/commit/91e5b701e1580f32d0172e9b9bcceb917f95f437) Thanks [@mdluo](https://github.com/mdluo)! - Migrate scaffolder from `.agents/skills` to `.claude/skills`

  The repo moved agent skills from `.agents/skills/` to `.claude/skills/` and replaced `AGENTS.md` with `CLAUDE.md`. This updates the scaffolder to match:

  - **Remove CLAUDE.md → AGENTS.md symlink** — scaffolded projects now have `CLAUDE.md` as the primary file, no symlink needed
  - **Copy skills directly to `.claude/skills/`** — no intermediate `.agents/skills/` directory or symlinks
  - **Clean up unused imports** — `readdirSync`, `rmSync`, `symlinkSync`, `relative` no longer needed
  - **Update biome exclude** — `!.agents` → `!.claude` in generated `biome.json`

## 0.6.1

### Patch Changes

- [`2428946`](https://github.com/vobase/vobase/commit/24289469613dbac3a82b1927a55a0096839fbbfc) Thanks [@mdluo](https://github.com/mdluo)! - Fix PGlite vector extension support in scaffolded projects. The drizzle-kit patch that enables `extensions` passthrough was being stripped during scaffolding, causing `db:push` to fail with `"$libdir/vector": No such file or directory` on any schema using `vector()` columns (e.g. AI module embeddings).

## 0.6.0

### Minor Changes

- [`0a4eef6`](https://github.com/vobase/vobase/commit/0a4eef68c4d812f5527fa5eca4ed6e1d25c51b62) Thanks [@mdluo](https://github.com/mdluo)! - Add knip for unused code detection, clean up dead code, and upgrade dependencies

  **Knip integration:**

  - Configure knip monorepo workspaces for root, core, template, and create-vobase
  - Scaffolder generates standalone `knip.json` for projects created with `bun create vobase`

  **Dead code cleanup:**

  - Delete 19 unused files: dead barrel re-exports, orphaned chat components, duplicate sheet/controls, 6 unused hooks
  - Remove 5 unused dependencies: `@ai-sdk/anthropic`, `@radix-ui/react-dialog`, `@radix-ui/react-direction`, `@tanstack/react-virtual`, `react-markdown`
  - De-export ~30 file-local types/interfaces, delete dead functions, tag test-only exports with `@lintignore`
  - Fix PGlite test isolation with unique temp dirs

  **Notable dependency upgrades:**

  - `typescript` 5.9 → 6.0
  - `drizzle-orm` / `drizzle-kit` beta.18 → beta.19
  - `@mastra/core` 1.15 → 1.17, `@mastra/memory` 1.9 → 1.10, `@mastra/hono` 1.2 → 1.3
  - `@electric-sql/pglite` 0.4.1 → 0.4.2
  - `better-auth` 1.5.5 → 1.5.6
  - `vite` 8.0.1 → 8.0.3
  - `@biomejs/biome` 2.4.8 → 2.4.9
  - `ai` (AI SDK) 6.0.138 → 6.0.140
  - `hono` 4.12.8 → 4.12.9

## 0.5.2

### Patch Changes

- [`20061f2`](https://github.com/vobase/vobase/commit/20061f263fdf666fd20e917af66b8192436f2989) Thanks [@mdluo](https://github.com/mdluo)! - # AI Module: Mastra Integration & Memory Pipeline

  ![AI Module](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-ai-module-0.20.0.png)

  ## Mastra Agent Architecture

  Replaced the database-driven agent factory pattern with static Mastra `Agent` instances using dynamic processors. Agents are now defined as code-level singletons with runtime-resolved input/output processors for moderation and memory.

  | Component          | What Changed                                                                                             |
  | ------------------ | -------------------------------------------------------------------------------------------------------- |
  | Agent instances    | `new Agent()` from `@mastra/core/agent` with static tools                                                |
  | Dynamic processors | `resolveInputProcessors` / `resolveOutputProcessors` via Mastra's `DynamicArgument` on `requestContext`  |
  | Tools              | Static singletons (`escalateToStaffTool`, `searchKnowledgeBaseTool`) reading deps from module-level refs |
  | Mastra singleton   | `mastra.ts` — central registry for agents, tools, workflows, memory                                      |
  | PGliteStore        | Custom storage adapter wrapping PGlite for Mastra's Memory in local dev                                  |
  | MastraServer       | Mounted at `/api/mastra` inside the vobase Hono server for Studio access                                 |

  ### Predefined Model Aliases

  Replaced env-var-based model configuration (`AI_MODEL`, `AI_EMBEDDING_MODEL`) with a typed model alias map. Agents pick models directly from the map — no conversion, no runtime config.

  ```typescript
  import { models } from "../lib/models";

  export const assistantAgent = new Agent({
    model: models.claude_sonnet, // 'anthropic/claude-sonnet-4-6'
  });
  ```

  | Alias           | Model ID                        |
  | --------------- | ------------------------------- |
  | `gpt_mini`      | `openai/gpt-5-mini`             |
  | `gpt_standard`  | `openai/gpt-5.2`                |
  | `claude_haiku`  | `anthropic/claude-haiku-4-5`    |
  | `claude_sonnet` | `anthropic/claude-sonnet-4-6`   |
  | `gemini_flash`  | `google/gemini-flash-latest`    |
  | `gemini_pro`    | `google/gemini-3.1-pro-preview` |
  | `gpt_embedding` | `openai/text-embedding-3-small` |

  ## Mastra Memory for Message Storage

  Thread messages are now stored and loaded via Mastra Memory instead of a custom `msg_messages` table. The `memory-bridge.ts` module wraps the Memory API for thread lifecycle operations.

  - `agent.stream()` and `agent.generate()` receive `memory: { thread, resource }` for auto-persistence
  - `GET /threads/:id` transforms Mastra's message format (`{ content: { format: 2, parts } }`) to the frontend's `DbMessage` format
  - Seed script initializes Mastra Memory independently for the seed context (separate process from server)
  - Removed `msg_messages` table — messages live entirely in Mastra Memory storage

  ## EverMemOS Memory Pipeline

  The memory formation pipeline (boundary detection → episode extraction → fact extraction → embedding) now uses module-level dependency injection via `lib/deps.ts` instead of constructor-injected factories.

  ## Guardrails & Moderation

  Added `onBlock` callback to the moderation input processor for logging blocked content. The `moderation-logger.ts` persists blocks to the new `ai_moderation_logs` table.

  ### API Endpoints

  | Endpoint                    | Description                    |
  | --------------------------- | ------------------------------ |
  | `GET /ai/guardrails/config` | Active guardrail rules         |
  | `GET /ai/guardrails/logs`   | Paginated moderation event log |

  ## Workflow Engine

  Added durable workflow run persistence with the `ai_workflow_runs` table. Escalation and follow-up workflows use Mastra's suspend/resume pattern with database-backed state.

  ### API Endpoints

  | Endpoint                             | Description                   |
  | ------------------------------------ | ----------------------------- |
  | `GET /ai/workflows`                  | List workflow definitions     |
  | `POST /ai/workflows/:id/trigger`     | Start a workflow run          |
  | `POST /ai/workflows/runs/:id/resume` | Resume a suspended run        |
  | `GET /ai/workflows/runs`             | Paginated run history         |
  | `GET /ai/workflows/runs/:id`         | Run detail with step timeline |

  ## Memory API

  Added paginated endpoints for browsing episodes and facts with scope-based filtering and keyset pagination.

  | Endpoint                         | Description                            |
  | -------------------------------- | -------------------------------------- |
  | `GET /ai/memory/episodes`        | Paginated episodes by scope            |
  | `GET /ai/memory/facts`           | Paginated facts, filterable by episode |
  | `DELETE /ai/memory/facts/:id`    | Delete a specific fact                 |
  | `DELETE /ai/memory/episodes/:id` | Delete episode + associated facts      |

  ## Evals Pipeline

  Eval scorers (answer relevancy, faithfulness) now use the predefined model alias directly instead of reading from env-var config.

  ## Frontend

  ### Agent Pages

  - Agent detail drawer with instructions, tools, channels, suggestions, and recent threads
  - "Chat with agent" action creates a thread and navigates to it
  - Model name displayed in card badge and detail header
  - Scrollable drawer content via `overflow-hidden` on `ScrollArea`

  ### Thread Routing

  Thread ID is now part of the URL path (`/messaging/threads/:id`) instead of a search param. Split into three route files:

  - `threads.tsx` — layout with persistent sidebar + `<Outlet />`
  - `threads.index.tsx` — welcome/new-chat view with agent selector and suggestions
  - `threads.$threadId.tsx` — chat view with empty-state placeholder when no messages

  ### Memory Pages

  - Memory timeline with scope selector (contact/user)
  - Episode/fact browsing with pagination
  - Memory search view with hybrid search

  ### Guardrails Pages

  - Guardrail config display
  - Moderation log list with pagination

  ### Workflow Pages

  - Workflow run history with status badges
  - Run detail view with step timeline

  ### New Components

  - `Sheet` component from shadcn/ui for agent detail drawer

  ## Dependencies Added

  | Package        | Purpose                                       |
  | -------------- | --------------------------------------------- |
  | `@mastra/hono` | Mount MastraServer routes inside Hono         |
  | `@mastra/pg`   | PostgresStore for Mastra Memory in production |

  ## Environment Variable Changes

  - **Removed**: `AI_MODEL`, `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_DIMENSIONS` — replaced by predefined model aliases
  - **Renamed**: `GEMINI_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` — aligns with `@ai-sdk/google` convention

  ## Scaffolder (create-vobase)

  The `create-vobase` scaffolder now generates a standalone `biome.json` during project creation. The template's `biome.json` uses `extends` to reference the monorepo root config, which doesn't exist in standalone projects — the scaffolder overwrites it with a self-contained config.

  ## Test Coverage

  293 tests passing across 29 files (657 assertions). Key test areas:

  - Moderation processor with `onBlock` callback (12 tests)
  - Memory boundary detection and extraction (24 tests)
  - Messaging handler routes with Memory-based flow (14 tests)
  - AI handler endpoints for memory, guardrails, workflows (new)
  - Eval scorer initialization

## 0.5.1

### Patch Changes

- [`e985f08`](https://github.com/vobase/vobase/commit/e985f08e325f6e36113f0bf287f5b6985c18d9ab) Thanks [@mdluo](https://github.com/mdluo)! - Remove unused `better-sqlite3` resolution from workspace root and drop redundant `db:current` step from scaffolder setup flow

## 0.5.0

### Minor Changes

- [`7bee4e5`](https://github.com/vobase/vobase/commit/7bee4e5bda35b6bec8e6e15ec65dabb7c27575fa) Thanks [@mdluo](https://github.com/mdluo)! - ## create-vobase

  ### Agent skills download

  Scaffolded projects now include the full vobase agent skills collection. During `bun create vobase`, skills are downloaded from the repo into `.agents/skills/` and symlinked into `.claude/skills/` so Claude Code discovers them automatically.

  ### Dynamic core schema resolution

  `drizzle.config.ts` now uses `require.resolve('@vobase/core')` to find core schema paths dynamically. This fixes `db:push` failing in scaffolded projects where core lives in `node_modules` instead of `../core`.

  ## @vobase/core (patch)

  ### Dockerfile fixes

  - Copy `patches/` and `stubs/` directories before `bun install` in both standalone and monorepo Dockerfiles — required for `patchedDependencies` and `better-sqlite3` resolution
  - Remove Litestream from monorepo Dockerfile
  - Remove `startCommand` from `railway.toml` (Dockerfile CMD handles startup)

  ### Template build fixes

  - Fix `Bun.Glob` directory scanning: pass `onlyFiles: false` to include module directories in `generate.ts`
  - Fix `ctx.user` possibly null errors: use non-null assertion in authenticated routes
  - Remove leftover `.all()` call in `channel-handler.ts`
  - Fix `JobOptions` properties: `delay` → `startAfter`, `retry`/`retries` → `retryLimit`
  - Fix `@ts-expect-error` placement for optional `@azure/msal-node` import
  - Add `postgres` dependency for `db-current.ts` production path

## 0.4.0

### Minor Changes

- [`4a7dd8e`](https://github.com/vobase/vobase/commit/4a7dd8e6a96491b851f1e88d07a983bfb2dbe04f) Thanks [@mdluo](https://github.com/mdluo)! - # PostgreSQL Migration

  ![PostgreSQL Migration](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-postgres-0.15.png)

  **BREAKING CHANGE:** Vobase now uses PostgreSQL instead of SQLite. PGlite provides zero-config embedded Postgres for local development. Production deployments use managed Postgres via `DATABASE_URL`. All SQLite dependencies, APIs, and patterns have been removed.

  ## Database Engine

  | Before                                     | After                                                   |
  | ------------------------------------------ | ------------------------------------------------------- |
  | `bun:sqlite` (synchronous)                 | PGlite local / `bun:sql` production (async)             |
  | `sqliteTable` + SQLite column types        | `pgTable` + Postgres column types                       |
  | `integer('col', { mode: 'timestamp_ms' })` | `timestamp('col', { withTimezone: true }).defaultNow()` |
  | `integer('col', { mode: 'boolean' })`      | `boolean('col')`                                        |
  | `blob('col')`                              | `bytea` or `jsonb`                                      |
  | `sqlite-vec` virtual tables                | Native `pgvector` extension                             |
  | FTS5                                       | Postgres `tsvector` / `tsquery`                         |
  | JS `nanoid()` via `$defaultFn`             | SQL `nanoid()` function via fixtures                    |
  | `.get()` for single row                    | `[0]` array access                                      |
  | `.all()` for multiple rows                 | Direct array return (removed)                           |
  | Synchronous Drizzle calls                  | `await` on every query                                  |

  The `VobaseDb` type is a single Drizzle Postgres instance — handler code never knows whether PGlite or `bun:sql` is underneath. `createDatabase()` auto-detects from the URL prefix and caches PGlite instances by path to prevent duplicate connections.

  ## Job Queue: bunqueue → pg-boss

  | Before                        | After                                          |
  | ----------------------------- | ---------------------------------------------- |
  | `bunqueue` (SQLite-backed)    | `pg-boss` (Postgres-backed)                    |
  | Separate SQLite file for jobs | Same Postgres database                         |
  | `FlowProducer` for job chains | Priority queues, singleton keys, retry backoff |

  The `createScheduler()` and `createWorker()` APIs are preserved with the same interface. A custom PGlite adapter routes DDL through `exec()` and parameterized queries through `query()` for pg-boss compatibility.

  ## PGlite Instance Management

  PGlite cannot have two instances on the same data directory. This release fixes several connection conflicts:

  - `createDatabase()` caches instances by path — calling it twice returns the same connection
  - `getPgliteClient()` exported to cleanly access the PGlite instance without `(db as any).$client`
  - `createApp()` passes the PGlite client directly to scheduler and worker (not the string path)
  - `getOrCreatePglite()` includes `vector` and `pgcrypto` extensions

  ## Template Scripts

  Scripts renamed to `db:*` namespace and converted to Bun-native APIs:

  | Before                          | After                                                           |
  | ------------------------------- | --------------------------------------------------------------- |
  | `bun run seed`                  | `bun run db:seed`                                               |
  | `bun run reset`                 | `bun run db:reset`                                              |
  | `scripts/migrate.ts`            | Removed (redundant — `drizzle-kit migrate` suffices)            |
  | `node:child_process`, `node:fs` | `Bun.spawnSync`, `Bun.write`, `Bun.file`, `$` shell, `Bun.Glob` |

  `db:reset` now runs `db:current` (SQL fixtures) before `db:push` — the nanoid function must exist before the schema references it.

  ## Adaptive drizzle.config.ts

  The config auto-detects the driver from `DATABASE_URL`:

  ```typescript
  const isPostgres =
    url.startsWith("postgres://") || url.startsWith("postgresql://");
  // Postgres URL → native driver, no extensions needed
  // Local path   → PGlite driver with vector + pgcrypto extensions
  ```

  `drizzle-kit` is patched via `patchedDependencies` to accept PGlite extensions in the config. Both `drizzle-kit` and `drizzle-orm` pinned to exact versions for patch compatibility. The patch and config ship with scaffolded projects.

  ## Scaffolder Updates

  `create-vobase` now runs `db:current` before `db:push` to install SQL fixtures (nanoid function, pgcrypto, pgvector extensions), and uses the renamed `db:seed` command.

  ## Deployment

  - `Dockerfile` uses `bun run db:migrate` instead of a custom migrate script
  - Set `DATABASE_URL` for managed Postgres in production
  - Litestream removed — use your Postgres provider's built-in backups

  ## Biome Configuration

  - Scoped to `packages/` source only (excludes `.agents/`, `poc/`, `.omc/`)
  - Excludes generated files (`*.gen.ts`, `*.generated.ts`) and vendored UI components
  - VCS integration enabled to respect `.gitignore`

  ## Removed

  - `bun:sqlite` and all SQLite dialect imports
  - `bunqueue` job queue
  - `sqlite-vec` vector extension and `lib/sqlite-vec.ts` platform loader
  - `litestream.yml` and all Litestream backup references
  - `better-sqlite3` native compile stub (kept — still needed by drizzle-kit)

  ## Type Fixes

  - WhatsApp adapter: guard for undefined media item in `sendMedia`
  - Channels webhook handler: default to empty array for undefined events
  - Drizzle introspection test: `'date'` → `'object date'` for timestamp dataType

  ## Migration Guide

  This is a full database engine replacement. There is no automatic data migration.

  1. Update `@vobase/core` to v0.15.0
  2. Replace all `sqliteTable` with `pgTable`, update column types
  3. Remove all `.get()` / `.all()` calls, add `await` to every Drizzle query
  4. Replace `bunqueue` imports — `createScheduler` / `createWorker` API unchanged
  5. Add SQL fixtures in `db/extensions/` (nanoid, pgcrypto, vector)
  6. Rename scripts: `seed` → `db:seed`, `reset` → `db:reset`
  7. Set `DATABASE_URL` in production; local dev uses PGlite automatically

## 0.3.0

### Minor Changes

- [`39d2ff1`](https://github.com/vobase/vobase/commit/39d2ff137d841090f21e585661631be581edb973) Thanks [@mdluo](https://github.com/mdluo)! - Support scaffolding into the current directory with `bunx create-vobase@latest .`, requiring a clean git working tree

## 0.2.4

### Patch Changes

- [`fc504cb`](https://github.com/vobase/vobase/commit/fc504cb37187caf1150d2e1dc781ba17f9646d7e) Thanks [@mdluo](https://github.com/mdluo)! - Fix login layout flash, first-click sign-in, and /system blank page redirect

## 0.2.3

### Patch Changes

- [`b2a205d`](https://github.com/vobase/vobase/commit/b2a205d35fc9c3c96ad4b99c532c2e44c9670ccc) Thanks [@mdluo](https://github.com/mdluo)! - Add colored output to scaffolder with green checkmarks and bold headings

## 0.2.2

### Patch Changes

- [`77016c6`](https://github.com/vobase/vobase/commit/77016c6964647e87eae5ff4bc962a0e82f5aefdb) Thanks [@mdluo](https://github.com/mdluo)! - Stub better-sqlite3 so drizzle-kit uses bun:sqlite driver; clean up seed script output

## 0.2.1

### Patch Changes

- [`eb36f3e`](https://github.com/vobase/vobase/commit/eb36f3e8b00547468e9e36a6d2bb2e0f7e12d112) Thanks [@mdluo](https://github.com/mdluo)! - Use stronger default password (Admin@vobase1) for dev admin to avoid browser warnings

## 0.2.0

### Minor Changes

- [`0ec8c7d`](https://github.com/vobase/vobase/commit/0ec8c7deade6d64bd98accde44e10498684dc4db) Thanks [@mdluo](https://github.com/mdluo)! - Rewrite scaffolder for bun-only runtime with full setup flow: resolve workspace deps, generate .env with random secret, create data dir, generate routes, and push schema to SQLite.

## 0.1.2

### Patch Changes

- [`1afa072`](https://github.com/vobase/vobase/commit/1afa072849dd12631138de075c1105015c259133) Thanks [@mdluo](https://github.com/mdluo)! - Replace workspace:\* dependencies with latest published versions when scaffolding a new project.

## 0.1.1

### Patch Changes

- [`6d3049c`](https://github.com/vobase/vobase/commit/6d3049c0cf483416187cace805ff840690ffed1f) Thanks [@mdluo](https://github.com/mdluo)! - Harden credential store encryption (scryptSync KDF, Buffer handling, ciphertext validation), fix db-migrate mkdir guard and rewrite tests with real SQLite databases, and fix create-vobase giget bundling with --packages=external.

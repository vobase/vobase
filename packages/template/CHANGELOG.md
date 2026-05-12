# @vobase/template

## 3.11.3

### Patch Changes

- [`b8df432`](https://github.com/vobase/vobase/commit/b8df432b5acfb6c1d1ee2c8cde4433b525e7b62c) Thanks [@mdluo](https://github.com/mdluo)! - fix(messaging): inbox now refreshes on customer inbound + optimistic staff reply

  Two inbox UX gaps:

  1. **Customer messages didn't surface until the agent replied.** The web
     adapter already fanned out an SSE `notifyConversation` post-write
     (`adapters/web/handlers/inbound.ts`), but the generic
     `modules/channels/service/inbound.ts` — used by every other adapter,
     including WhatsApp — did not. The staff inbox then waited on the wake's
     own `tool_execution_end` notify, which could be seconds away (and never
     fires if the agent no-ops). Added the same post-write
     `notifyConversation(result.conversation.id)` call to the generic
     inbound path so every channel surfaces customer messages immediately.

  2. **No optimistic update when replying from the inbox.** `useStaffReply`
     only invalidated `['messages', …]` `onSuccess`, so the staff bubble
     appeared only after the server roundtrip. The hook now prepends a
     sentinel `Message` (id: `optimistic-${ts}`, status: `'sending'`,
     metadata: `{ optimistic: true }`) on `onMutate`, restores the snapshot
     on error, and invalidates on `onSettled` so the real row replaces the
     sentinel as soon as the server response arrives.

- [`845d0f7`](https://github.com/vobase/vobase/commit/845d0f75fc7c0fdf0f11fee42980f86c34de9eba) Thanks [@mdluo](https://github.com/mdluo)! - fix(messaging): suppress SSE messages refetch during pending staff-reply

  The optimistic reply bubble appeared correctly on `onMutate`, but the
  SSE-driven `conversations`-table notify (fired by the reply handler's own
  `notifyConversation`) raced the mutation's HTTP response: the resulting
  `['messages', conversationId]` refetch replaced the optimistic row with
  the persisted one mid-flight. Because the optimistic id (`optimistic-…`)
  differs from the server-issued id, React re-keyed the row, AI-elements
  `Conversation` (`use-stick-to-bottom`) observed the resize, and the
  bubble visibly bounced with a one-frame gap.

  - `useStaffReply` now sets `mutationKey: ['staff-reply', conversationId]`
    (exported as `STAFF_REPLY_MUTATION_KEY`).
  - `useRealtimeInvalidation` checks
    `isMutating({ mutationKey: ['staff-reply', payload.id] })` before
    invalidating `['messages', payload.id]` on a `conversations` notify,
    deferring to the mutation's own `onSettled` for the final reconcile.

- [`552d47d`](https://github.com/vobase/vobase/commit/552d47dc1729107e7cc040134e600e14f1d7e099) Thanks [@mdluo](https://github.com/mdluo)! - fix/feat(wake, messaging, realtime, channels): backport batch from downstream tenant

  Sixteen changes rolled up from a production tenant where each was
  verified against live agent traffic. Grouped by area:

  ## wake/learning (triage)

  1. **Resolved model id passed to triage LLM.** Triage was passing the
     bare alias key `gpt_mini` as `LlmRequest.model`; `createModel`
     expects the fully-qualified `provider/model` id, so the lookup
     silently fell back to `DEFAULT_CHAT_MODEL` (Sonnet), defeating the
     cheap-model triage. `thresholds.ts` now hardcodes `triageModel` to
     `models.gpt_mini`; `triage-prompt.ts::shouldStubTriage` switches on
     the `openai/` / `anthropic/` / `google/` provider prefix.

  2. **Triage drop log + prompt clarity.** A `self_reflection` signal
     dropped with confidence 0.97 read like a threshold bug, but
     `worth_attention` is the gate and `confidence` is the LLM's
     certainty about that classification — a confident "no" is also
     high confidence. Log line now spells out
     `worth_attention: false`. Dropped the contradictory "if not worth
     attention then confidence ≤ 0.2" instruction from the system
     prompt and added a signal-interpretation block: for
     `self_reflection` the journal activity is the signal, while for
     `staff_takeover` / `coexistence_echo` / `coaching_note` /
     `rejection` the `signalBody` is the signal.

  3. **Expanded triage LLM context.** The cheap-model triage was running
     with a 10-row text-only journal, no contact memory, and no
     agent-role description. Now pulls `agent_definitions.instructions`
     (head 300 chars), wires `contactMemoryHead` via `conversations` →
     `contacts.memory`, appends `toolName` + `toolCalls` + `payload`
     from `conversation_events`, bumps the journal window 10 → 20 rows
     and truncation 2000 → 4000 chars. The three context queries run
     in parallel via `Promise.all`. Sub-cent per triage on `gpt_mini`.

  4. **`journalContext` sourced from `messaging.messages`.** The triage
     prompt's journal was reading `harness.conversation_events`, which
     only contains wake harness events and conversation lifecycle rows
     — the actual customer/staff/agent message bodies live in
     `messaging.messages`. Replaced the query and rendered each row via
     the canonical `summarizeMessageContent` (matching `vobase
messaging messages` and the unread-activity preamble).

  ## wake (conversation cue + debounce)

  5. **Unread activity inlined into conversation-lane wake cues.** Wakes
     now carry an activity preamble (customer messages, staff notes,
     internal events) so the agent sees what happened during its
     absence without a separate tool call.

  6. **Trigger leads, activity is appendix.** When a `staff_note` wake
     fired alongside customer frustration messages from the prior wake,
     the unread-activity preamble landed above the trigger cue and the
     agent attended to the customer pile first. Flipped the cue order:
     trigger first, `---`, then the activity block.

  7. **Inbound bursts debounced to one wake per conversation.** Multiple
     inbound messages arriving in quick succession used to each enqueue
     a wake; only the first now wins until the wake drains, the rest
     are coalesced via a state-machine update in `channels/service/state.ts`.
     New live smoke: `tests/smoke/smoke-debounce-live.ts`.

  ## messaging

  8. **Staff-note actions described as composable in AGENTS.md.** The
     routing table presented its bullets as mutually exclusive paths,
     so the agent picked one ("relay") and stopped — needing three
     subsequent prompts to coax a memory write. Intro now names the
     dual nature of brief staff answers; step 2 heading notes that
     more than one bullet often applies.

  9. **Staff "mine" alignment scoped to the actual sender.** Message-thread
     alignment was using `directory.staff[0]` as the implicit "me",
     causing every staff message to right-align for every staff viewer.
     Now matches against the resolved viewer id.

  10. **Staff author matched from `[Name]` prefix, not
      `directory.staff[0]`.** New `messaging/lib/staff-prefix.ts` parses
      the bracketed name prefix; `staff-reply.ts` and
      `message-thread.tsx` consume it for both write and render.

  ## realtime

  11. **`safeNotify` helper consolidates notify try/catch.** `runtime/index.ts`
      now exports `safeNotify`; `contacts`, `team`, and `agents` services
      use it instead of inline try/catch blocks around `pg_notify`.

  12. **Inbox names refresh live; ownership filter labels resolve.**
      `agents`/`team` modules now declare realtime keys for their
      principal rows; `use-realtime-invalidation.ts` maps them so the
      conversation list and ownership filter relabel without a manual
      refresh.

  ## channels (web adapter)

  13. **"Open" button on web-channel table rows.** New
      `channels/components/chat-url.ts` derives the public `/chat/<id>`
      URL; the row menu and details sheet expose it.

  14. **Public `/chat` page no longer sticks on "Assistant is thinking…".**
      The web adapter's `messages` handler now emits a turn-end event
      the chat page consumes; `wake/workspace/create.test.ts` updated.

  ## runtime

  15. **Request logger dropped to debug and off in production.** Hono
      logger was at info; in production it spammed access logs without
      adding signal. Set to debug, env-gated off in production.

  ## docs

  16. **`vobase-cli-ops` skill** — `--local` version floor, auth
      troubleshooting, drive verb notes. (Shared skill — already in sync
      at the repo root, no template change.)

## 3.11.2

### Patch Changes

- [`421ec4d`](https://github.com/vobase/vobase/commit/421ec4dfa41ef3ad79e430eadf9590c81bcdd57f) Thanks [@mdluo](https://github.com/mdluo)! - fix(template/channels): release sandbox via managed endpoint + soft-delete instead of hard

  Releasing a sandbox WhatsApp channel from the UI returned 500 because the
  WhatsApp row menu's delete button called the generic
  `DELETE /api/channels/instances/:id` — which doesn't release the
  platform-side `managed_whatsapp_channel_claims` row, and hits
  `fk_conv_channel_instance` (`ON DELETE RESTRICT`) the moment a conversation
  has routed through this channel. The intent in the existing dialog copy is
  already "Existing conversations are preserved but no new messages will be
  received", so this switches the contract to soft-delete:

  - `service/instances.ts::remove` now flips `status` to a new
    `RELEASED_STATUS = 'released'` sentinel instead of hard-deleting.
    `list()` filters those rows out so they neither surface in the channels
    listing nor short-circuit the managed-claim idempotency probe.
  - `channel-row-menu.tsx` dispatches managed channels to the dedicated
    `DELETE /api/channels/whatsapp/managed/:instanceId` so the platform
    claim release runs before the tenant-side soft-delete; self channels
    still use the generic path (now also soft-delete).

- [`5a417f4`](https://github.com/vobase/vobase/commit/5a417f46308dd8d3621649eb1e854ae984dbcab2) Thanks [@mdluo](https://github.com/mdluo)! - fix(template/whatsapp): write `agent:<id>` (not bare id) as the sandbox channel's default assignee

  The managed-WhatsApp claim handler was writing the bare `agentDefinitions.id`
  into `channel_instances.config.defaultAssignee`, but the canonical principal
  token format used by every other writer (`modules/contacts/seed.ts`, the web
  instance create form), every reader (`<Principal id=…>`, mention rendering,
  hover cards), and the `conversations.assignee` column itself (via
  `initialAssignee` in `dispatchInbound`) is `agent:<id>`. The mismatch showed
  up in the channels table as a raw 8-character id instead of the agent's
  name, and would also have broken assignee resolution on the first inbound
  message after claim.

  The one downstream reader that strips the `agent:` prefix to do a DB lookup
  (`web/service/instances.ts` → `loadHydrationFor`) now strips it uniformly
  from both the conversation's assignee and the instance's defaultAssignee,
  so the seed flow (`defaultAssignee: 'agent:agt0meri0v1'`) keeps working.

- [`46bd416`](https://github.com/vobase/vobase/commit/46bd41623b8a904f97aadf05808e786ce62a9e1c) Thanks [@mdluo](https://github.com/mdluo)! - fix(template/whatsapp): derive sandbox-claim environment from STAGING env, not NODE_ENV

  The Dockerfile pins `ENV NODE_ENV=production` for every tenant container,
  so a staging Railway deployment running `NODE_ENV=production` was claiming
  a `production`-tier sandbox channel — the link message rendered
  `mgd-<orgId>-production` even on the staging URL. The platform's
  `set-staging-env-vars` step already stamps `STAGING=true` only on staging
  Railway environments (production leaves it unset), so the tenant now reads
  that flag to pick `production | staging` for `/managed/claim`. The
  resulting `(tenant, environment, channelInstanceId)` key — and the
  platform-pool slot it allocates — now corresponds to the deploy
  environment the user is sitting in.

- [`096a317`](https://github.com/vobase/vobase/commit/096a3179e172a17ed611c607ec58a022e723b40e) Thanks [@mdluo](https://github.com/mdluo)! - fix(whatsapp): use tenant slug, not nanoid, for webhook verify-token derivation

  The sandbox-claim flow's earlier `X-Tenant-Id` fix correctly switched the
  platform-call header to `PLATFORM_TENANT_ID` (the nanoid), but also accidentally
  passed the nanoid as `tenantSlug` into `deriveVerifyToken`. The WhatsApp adapter's
  GET hub-challenge handler derives the expected token from
  `VITE_PLATFORM_TENANT_SLUG` (the human slug), so the two HKDF derivations
  disagreed. Platform's webhook self-registration GET hit the tenant URL with the
  wrong `hub.verify_token`, got 403, and surfaced in the UI as
  "platform webhook registration failed (400: http_403)".

  Threaded `tenantSlug` through `PlatformCreds` and use it for verify-token
  derivation on both `/managed/claim` and `/managed/:id/webhook/re-verify` paths.
  `X-Tenant-Id` continues to use the nanoid via `tenantId`.

## 3.11.1

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

- Updated dependencies [[`9eefb19`](https://github.com/vobase/vobase/commit/9eefb19a00207c19a77e53dd301a576eaa399ead)]:
  - @vobase/core@0.42.1

## 3.11.0

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

### Patch Changes

- Updated dependencies [[`44bb9a1`](https://github.com/vobase/vobase/commit/44bb9a1af944767ca8925301b8f5e113cd200a46)]:
  - @vobase/core@0.42.0

## 3.10.0

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

### Patch Changes

- Updated dependencies [[`4bfa583`](https://github.com/vobase/vobase/commit/4bfa583553c50092ef7ca917059bed1d98d224af)]:
  - @vobase/core@0.41.0

## 3.9.0

### Minor Changes

- [`85ae97c`](https://github.com/vobase/vobase/commit/85ae97c254ba232042e7a447e68f1f1eef5fcfbb) Thanks [@mdluo](https://github.com/mdluo)! - feat(agents,messaging): admin-tier CLI verbs for live-tenant debugging

  Adds a read-only debug surface so operators on remote deployments can diagnose agent behavior without direct DB access:

  - `agents debug wakes --conversationId=<id>` — wake-by-wake summary (trigger, turns, tool calls, cost, `systemHash`, end reason). The `systemHash` column reveals frozen-snapshot drift across wakes.
  - `agents debug timeline --wakeId=<id> [--full]` — per-wake event timeline from `harness.conversation_events` (turn*start, message*_, tool*dispatch*_, tool*execution*\*, llm_call, agent_end). Truncates content to 200 chars unless `--full`.
  - `agents debug llm-io [--conversationId|--wakeId] [--seq=N:M] [--role] [--tool] [--limit] [--full]` — dump of `harness.messages` showing what pi-agent-core sent/received: user cues, assistant tool-calls with arguments, tool results, token + cost per row. `--wakeId` auto-derives the conversation and `agent_start..agent_end` time window.
  - `messaging messages --id=<conv>` — staff-tier verb returning customer/agent/staff message bodies (complements `messaging show` which returns activity events but no bodies).
  - `messaging notes --id=<conv>` — staff-tier verb that renders `INTERNAL-NOTES.md` byte-identical to the materializer the agent reads inside its bash sandbox.

  All five verbs route through a new `DebugReadersService` (singleton + free-function wrappers, matching the agents-module convention) and respect organization scoping.

### Patch Changes

- [`3d42883`](https://github.com/vobase/vobase/commit/3d42883e2fb3b3a05d034ce90a446a76020a5ffb) Thanks [@mdluo](https://github.com/mdluo)! - fix(wake/build-base): route journal writes through `appendJournalEvent` wrapper

  `buildJournalAdapter` called core's `journalAppend` directly, which only persists the reserved columns and drops every non-reserved AgentEvent field. As a result `agent_start.payload` landed as `null` and downstream debug surfaces couldn't recover `trigger`, `triggerPayload`, `systemHash`, or `agent_end.reason`. The template wrapper at `@modules/messaging/service/journal` auto-extracts those fields into the `payload` jsonb column — now used by every flavour.

- [`632107e`](https://github.com/vobase/vobase/commit/632107ee8c80003be430ad7db62a597c57014414) Thanks [@mdluo](https://github.com/mdluo)! - fix(runtime/bootstrap): map better-auth `owner` role to `admin` audience tier

  `getAudience` only checked `p.role === 'admin'`, so org owners (who outrank admin in better-auth's `owner > admin > member` hierarchy) were demoted to the `staff` audience tier and couldn't see admin-tier CLI verbs in the catalog. Both `owner` and `admin` now map to `'admin'`.

## 3.8.3

### Patch Changes

- [`b50a3e3`](https://github.com/vobase/vobase/commit/b50a3e323a01637554d6cb5587902d362fa2b491) Thanks [@mdluo](https://github.com/mdluo)! - fix(wake/trigger): inline new-event body in inbound/staff-note/caption-ready cues

  The wake-cue renderer for `inbound_message`, `staff_note`, and `caption_ready` was pointer-only — it told the agent "Read /contacts/<id>/INTERNAL-NOTES.md for context" rather than including the body itself. Models sometimes skipped the follow-up `cat`, replied from stale context, and (e.g.) ignored a staff note like "@MeriGPT yes we are" in favor of a generic "billing team will follow up" stall.

  Producers now thread the latest body through the trigger payload (`channels/service/inbound`, two web-channel handlers, `messaging/service/notes` fan-out, `drive/jobs` + `drive/service/files`); the renderer inlines it as a markdown blockquote with an explicit "full thread in …" pointer to the materialized file. Mirrors the operator-thread renderer's existing blockquote pattern.

  `truncateForCue` caps the inlined body at 4 KB UTF-8 on a line boundary (marker bytes pre-reserved so the returned string is guaranteed ≤ cap), matching the harness's 4 KB inline tool-stdout budget. All body fields are optional — legacy queue rows mid-deploy fall back to the original pointer-only cue.

## 3.8.2

### Patch Changes

- Updated dependencies [[`84df3b9`](https://github.com/vobase/vobase/commit/84df3b959e9ec0b01fed74513052bd62ebde98b0), [`a9dc138`](https://github.com/vobase/vobase/commit/a9dc1385c5ee4ebee79e18c72b19995d5d984e75)]:
  - @vobase/core@0.39.0

## 3.8.1

### Patch Changes

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

- Updated dependencies [[`660dc2b`](https://github.com/vobase/vobase/commit/660dc2b06d1b69488609b339bc4ea43d7937c988)]:
  - @vobase/core@0.38.0

## 3.8.0

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

- Updated dependencies [[`5ee1afd`](https://github.com/vobase/vobase/commit/5ee1afd390b3b0fffbdc9d46fc3d95e5763ee14e), [`8f376ea`](https://github.com/vobase/vobase/commit/8f376eac4a1512b68123b3828d74f83dfa2b3fd9)]:
  - @vobase/core@0.37.0

## 3.7.0

### Minor Changes

- [`ca13867`](https://github.com/vobase/vobase/commit/ca138676411ef53d43b6dbc8972e2cdc4772d739) Thanks [@mdluo](https://github.com/mdluo)! - template: PROFILE.md is now read-only at the workspace level. Customer-asked profile updates flow through the new `vobase contacts propose-change` CLI verb (default `--kind field_set`; `--kind markdown_patch` for prose). Non-gated fields auto-apply; gated fields (`displayName`, `email`) queue for staff review. Activity events (`change.proposed` / `change.auto_applied` / `change.approved` / `change.rejected`) render inline in the staff-inbox timeline with the proposing/deciding principal and a discrete InfoIcon HoverCard for rationale + decision notes.

  template: GFM tables in AGENTS.md (and other markdown surfaces using the same Plate editor) now render in the content editor — added `@platejs/table` and registered table/row/cell/header element components. Previously the Memory-scopes table appeared as blank space.

  template/changes: duplicate-pending proposals on the same contact now surface as a typed `pending_conflict` errorCode (with `existingProposalId`) instead of a generic 409. The `vobase contacts propose-change` verb prompt instructs the agent to acknowledge the prior pending request rather than fabricate an approval.

  core/workspace: removed unused `contactProfile` / `staffProfile` dirty-diff buckets from `ScopedDiff`. The template no longer tracks PROFILE.md frontmatter as dirty (it's RO and rendered from the row).

### Patch Changes

- Updated dependencies [[`ca13867`](https://github.com/vobase/vobase/commit/ca138676411ef53d43b6dbc8972e2cdc4772d739)]:
  - @vobase/core@0.36.1

## 3.6.3

### Patch Changes

- [`a001687`](https://github.com/vobase/vobase/commit/a001687fab50f16f5c5575908373b5b27a168c55) Thanks [@mdluo](https://github.com/mdluo)! - # Internal-note attribution + @-mention-only supervisor fan-out

  Two related fixes around staff-authored internal notes.

  ## Timeline now shows real names instead of "Customer" / "Staff"

  Two attribution bugs in the conversation timeline:

  - **Internal notes always rendered as "Staff."** `useSendNote` was hard-coding `authorId: 'staff'` (literal string) when posting, so `internal_notes.author_id` could never be resolved by the principal directory and every freshly-sent note fell through to the generic "Staff" label. The hook now requires the real `currentUserId` (passed in from `useCurrentUserId()` in `Composer`) so notes carry the canonical `staff:<userId>` token and resolve to the staff member's display name + avatar.
  - **Customer messages always rendered as "Customer."** `messagePrincipal` returned `null` for `role === 'customer'` because rows don't carry a sender id, leaving the bubble's fallback ("Customer") in place. `MessageThread` now accepts the conversation's `contactId`; customer rows resolve via `directory.resolve('contact:<id>')` to the actual contact name. `ConversationDetail` threads `contactId` through. The other `MessageThread` caller (`ConversationContextSnippet` in proposal rows) doesn't have a `contactId` in scope and keeps the previous "Customer" fallback — no behavior change there.

  Staff-message rows still resolve to the alphabetically-first staff member because `messages` rows don't carry a `senderUserId` column; that's a schema change separate from this fix.

  ## Internal notes only wake an agent when the agent is @-mentioned

  Previously, every staff-authored note triggered an unconditional supervisor wake on the conversation's assignee agent — which in turn appended a "memory note" entry as the agent processed the wake. The new rule is simpler and matches staff intent: **a note only wakes an agent when staff explicitly `@-mentions` that agent.**

  Effects:

  | Note in MeriGPT-assigned conv                   | Before                                     | After                                   |
  | ----------------------------------------------- | ------------------------------------------ | --------------------------------------- |
  | `"hey team, fyi"` (no mention)                  | 1 wake (assignee)                          | **0 wakes**                             |
  | `"@Sentinel can you look?"`                     | 2 (assignee + Sentinel)                    | **1 (Sentinel)**                        |
  | `"@MeriGPT please double-check"` (self-mention) | 1 (assignee, `mentionedAgentId=undefined`) | **1 (with `mentionedAgentId=MeriGPT`)** |
  | `"@Sentinel @Atlas"`                            | 3                                          | **2**                                   |
  | Agent-authored note                             | 0                                          | **0 (unchanged)**                       |

  `runSupervisorFanOut` (`modules/messaging/service/notes.ts`) drops the unconditional assignee self-wake and the self-mention skip; it now iterates only over agents resolved by `resolveAgentMentionsInBody` and short-circuits when there are none.

  `isPeerWake` in `wake/conversation.ts` is redefined from "the booted agent IS the mentioned one" to "the booted agent is NOT the conversation assignee." This preserves the original "ownership" distinction across the fan-out change: an `@`-mentioned assignee still goes through the `coaching` / `ask_staff_answer` classifier (and the coaching-strip filter on customer-facing tools), while an `@`-mentioned non-assignee continues to behave as a peer consultation with reply tools available but a render that explicitly tells them not to send a customer-facing reply.

  `tests/e2e/supervisor-mention-fanout.test.ts` updated to reflect the new shape — cases (a)–(d) lose the implicit assignee wake and case (b) self-mention now carries `mentionedAgentId=MeriGPT`. New case `(f)` covers the "plain note → 0 enqueues" path so the @-mention-only rule has explicit coverage.

  **Changed:**

  - `modules/messaging/hooks/use-send-note.ts` — `useSendNote(conversationId, authorId)` now requires the real user id; throws on a null `authorId`.
  - `modules/messaging/components/composer.tsx` — passes `useCurrentUserId()` into the hook.
  - `modules/messaging/components/message-thread.tsx` — `MessageThread` accepts `contactId`; `messagePrincipal` resolves customer rows via `contact:<id>`.
  - `modules/messaging/components/conversation-detail.tsx` — threads `contactId` through.
  - `modules/messaging/service/notes.ts` — supervisor fan-out only enqueues for `@-mentioned` agents.
  - `wake/conversation.ts` — `isPeerWake` reframed against the conversation assignee.
  - `wake/supervisor.ts`, `runtime/bootstrap.ts` — doc comments updated.
  - `tests/e2e/supervisor-mention-fanout.test.ts` — assertions updated for the new fan-out, plus a new plain-note coverage case.

  No schema changes.

## 3.6.2

### Patch Changes

- [`759bf6c`](https://github.com/vobase/vobase/commit/759bf6c091efa74c7d1c108b30c81ac26cb9b9ea) Thanks [@mdluo](https://github.com/mdluo)! - # Resizable Drive + collapsible AGENTS.md preamble

  Three UI tweaks on the agent detail page (`/agents/<id>`) and any page that embeds `<DriveSection>`:

  - **Drive split is now user-resizable.** Both the horizontal Drive layout (contact + staff detail pages) and the vertical Drive layout (agent detail page) now wrap the file list and preview in `react-resizable-panels` `Group`/`Panel` with a draggable `GradientResizeHandle` between them. Sizes persist per-orientation in `localStorage` (`vobase:drive-horizontal`, `vobase:drive-vertical`).
  - **File list defaults to a smaller portion in vertical layouts.** The vertical split was a fixed 1:2 grid (33% file list / 67% preview). New default is 28% / 72%, and the user can drag to anywhere between 15%–60% for the list. Horizontal layouts default 40% / 60% (was a fixed 1:1).
  - **AGENTS.md auto-generated preamble is collapsed by default.** On the agent detail page, the read-only preamble at the top of `/AGENTS.md` previously occupied the full preview height and forced staff to scroll past it before they could see the editable instructions. The preamble now opens collapsed (`max-h-32` with a bottom-fade) with a `Show more / Show less` toggle, and its background is `bg-muted` (was `bg-muted/40`) so it visually separates from the surrounding `bg-background` `InfoCard` instead of blending in.

  **Changed:**

  - `modules/drive/components/drive-browser.tsx` — replaces the orientation-conditional CSS grid with `react-resizable-panels`. The empty-preview path (no file selected) keeps a plain full-bleed file list. Mobile fallback is unchanged (single pane with a back-bar).
  - `modules/agents/components/agents-md-editor.tsx` — `PreambleView` gains a `useState` collapse toggle and a fade-mask overlay; bg bumped to `bg-muted`.
  - `src/components/ui/gradient-resize-handle.tsx` — `GradientResizeHandle` gains a `direction: 'col' | 'row'` prop. Default `'col'` keeps existing call sites byte-identical; `'row'` switches to `h-px w-full cursor-row-resize` for use inside a vertical `Group`.

  No backend, schema, or harness changes.

## 3.6.1

### Patch Changes

- [#75](https://github.com/vobase/vobase/pull/75) [`61b46b9`](https://github.com/vobase/vobase/commit/61b46b9b3daa18b0c4ef509881db8a4947eef0fc) Thanks [@amirahillyana](https://github.com/amirahillyana)! - fix(template): resolve dist/web from project root in production server

  `runtime/bootstrap.ts` computed the SPA dist directory as `join(import.meta.dir, 'dist', 'web')`, which resolves to `/app/runtime/dist/web` at runtime. The Vite build outputs to `/app/dist/web`, so the `index.html` lookup always failed and the static-files block silently no-op'd — every freshly-deployed tenant returned Railway's edge 404 on `/`. Walk one directory up so the path matches the Dockerfile layout.

## 3.6.0

### Minor Changes

- [`354da30`](https://github.com/vobase/vobase/commit/354da30c3dfd9edb84d9ab3a8e04efb213c24d0e) Thanks [@mdluo](https://github.com/mdluo)! - # profile.md becomes the canonical editable view for contacts and staff

  YAML frontmatter at the top of `/contacts/<id>/profile.md` and `/staff/<id>/profile.md` is now the agent's structured-edit surface. The workspace-sync observer parses dirty profile.md, computes a diff against the canonical row, and submits a `field_set` change-proposal. Approval routes through the existing change-proposal pipeline:

  - **Contacts** auto-apply by default; `displayName` and `email` queue for staff approval via the new `requiresApprovalForFields` registry option.
  - **Staff** join the change-proposal pipeline for the first time (`requiresApproval: true`); all staff edits queue.
  - **Markdown patches** to `profile` are no longer accepted on contacts — `MARKDOWN_FIELDS` is `{'memory'}` only. profile.md body below the frontmatter is auto-rendered.

  **New surface:**

  - `wake/profile-frontmatter.ts` exports `renderContactFrontmatter`, `renderStaffFrontmatter`, `parseFrontmatter`, and `diffProfile`. Render output is byte-stable (sorted keys, double-quoted strings, omits null / empty fields). Parser uses Bun's YAML 1.2 default so date strings stay strings.
  - `modules/team/service/changes.ts` (new) ships `staffChangeMaterializer` for the `(team, staff)` resource pair. Allowed scalars: `{displayName, title, availability, capacity, expertise, sectors, languages}` plus `attributes.*`. `email` lives in `auth.user` and is intentionally out-of-scope for v1 (rejected with a `validation` error if proposed).
  - `runtime/tz.ts` exports `ORG_TIMEZONE = process.env.TZ ?? 'Asia/Singapore'` as the seam for org-wide `date`-attribute interpretation.

  **Changed:**

  - `modules/changes/service/proposals.ts`: `registerChangeMaterializer` gains `requiresApprovalForFields?: ReadonlySet<string>`. When a `field_set` proposal touches a gated top-level scalar key, the proposal is forced to `pending` regardless of the resource-level default. `attributes.*` keys are not gated.
  - `modules/contacts/agent.ts` and `modules/team/agent.ts`: profile.md materializers emit frontmatter via the new renderer; the read-only hint for profile.md paths is removed; AGENTS.md contributors are reframed to describe the editable frontmatter surface.
  - `modules/agents/agent.ts`: the `agents.memory-conventions` contributor gains a `## Structured fields vs prose memory` section covering the three capture-trigger categories (customer-volunteered facts, staff-volunteered facts in internal notes, high-confidence inferences) plus the explicit `frontmatter vs MEMORY.md` split rule.
  - `wake/observers/workspace-sync.ts`: on `agent_end`, profile.md edits route through `insertProposal` with a `field_set` payload built from `diffProfile(baseline, current)`. Unknown keys are dropped before `insertProposal` and warned. Empty diffs (reordered keys, no value change) produce zero proposals.
  - `wake/workspace/index.ts`: profile.md paths move from `readOnlyExact` to `memoryPaths` so they're writable and tracked by the dirty diff.

  **Manual smoke (not CI-gated).** Reproduce the GK Corp scenario against the dev server:

  ```bash
  # 1. Send a customer message that volunteers structured facts.
  curl -X POST http://localhost:3001/api/channels/web/inbound \
    -H 'Content-Type: application/json' \
    -d '{"contactId":"<id>","body":"I work at Northwind Logistics, 120 employees, renewal in September","externalKey":"web:demo"}'

  # 2. Wait for agent_end; inspect the change_proposals row.
  psql $DATABASE_URL -c "select id, status, payload from changes.change_proposals where resource_id='<id>' order by created_at desc limit 1;"

  # 3. Confirm contacts.attributes was updated post-apply.
  psql $DATABASE_URL -c "select attributes from contacts.contacts where id='<id>';"
  ```

  Expected: one `change_proposals` row with `kind: 'field_set'` containing the three new attribute keys, status `auto_written` (no gated keys touched), and `contacts.attributes` reflecting the merged values.

  ## Lifecycle observability + agent acknowledgement

  Built on top of the field_set work above so staff and the customer both get continuous feedback as a profile-edit moves through propose → decide → apply.

  **New surface:**

  - `wake/observers/sensitive-write-warner.ts` — `OnToolResultListener` that diffs `/contacts/<id>/profile.md` and `/staff/<id>/profile.md` after every `bash` tool call, lazily baselined per wake. When a gated frontmatter field (`displayName`, `email`) is touched it appends a `vobase notice:` block to the bash result's `stderr` — the _same_ tool result the model is about to read — so the next assistant message can phrase the customer reply as a request that's been queued for staff review rather than confirming a change that's still pending. Cheap short-circuit on `args.command` keeps the disk reads off the hot path when the bash call doesn't reference a profile path. Gated key sets live in `wake/observers/gated-fields.ts` so workspace-sync and the warner share one source of truth.
  - `wake/change-decided.ts` — `CHANGES_DECIDED_TO_WAKE_JOB` (`changes:decided-to-wake`) bridge: the decide endpoint enqueues a wake on conversation-bound proposals only (filters synthetic `operator-`/`heartbeat-` ids), `pg-boss` singletonKey on `(conversation, proposal, decision)` dedups rapid clicks. The handler boots a conversation-lane wake with the new `change_decided` trigger.
  - `wake/events.ts` adds the `change_decided` `WakeTrigger` variant with `{proposalId, decision, resourceModule, resourceType, resourceId, summary, decidedNote, decidedBy}`. `wake/trigger.ts` registers the renderer (`renderChangeDecided`): on approval it requires a fresh customer reply even if the agent previously said "logged for review"; on rejection it surfaces the staff note to the agent (verbatim, marked "for your understanding only — do NOT quote") and asks for a polite acknowledgement. Both branches forbid re-attempting the write.
  - `modules/changes/service/lifecycle-summary.ts` — backend-safe `summarizeLifecycleEvent` produces a short, contextual one-liner suitable for inline timeline rendering ("Email change to marc@x.com", "Display name and email change", "3 contact fields updated", "Memory note appended"). 12 unit tests pin behaviour.
  - `tests/helpers/changes-smoke.ts` — atomic helpers (`open`, `sendInbound`, `waitForReply`, `insertPending`, `decide`, `listJournal`, `listActivity`, `listTranscript`, `close`) for stepping through the propose/decide/wake pipeline interactively against a live dev server. Reuses `devLogin` + `makeAuthedFetch` from `tests/smoke/_helpers.ts`.

  **Changed:**

  - `modules/changes/service/proposals.ts`: emits 4 lifecycle events into `harness.conversation_events` for any conversation-bound proposal — `change.proposed`, `change.auto_applied`, `change.approved`, `change.rejected`. The journal write is best-effort (try/catch + warn so a missing journal service in unit tests doesn't roll back the proposal tx). Emit sites consolidated via a `LifecycleVariant` discriminated union; the helper derives `proposalId`, `kind`, `resource*`, and `summary` from the proposal row so call sites only specify what varies. The decide endpoint additionally enqueues `CHANGES_DECIDED_TO_WAKE_JOB` for conversation-bound proposals.
  - `modules/changes/module.ts`: installs a `decidedScheduler` that bridges service-level decide calls to the new pg-boss job.
  - `modules/messaging/service/conversations.ts`: `TIMELINE_ACTIVITY_TYPES` extended with the 4 new `change.*` types so they flow through the existing `/api/messaging/conversations/:id/activity` endpoint.
  - `modules/messaging/components/message-thread.tsx`: new `<ChangeActivityLine>` renders the journal `summary` as the primary line (rationale + decidedNote move to a `HoverCard` so the timeline stays scannable). The whole row links to `/changes?id=<proposalId>` so staff can jump to the proposal record. Suppresses system-emitted rejection tokens (`staff_rejected`, `threat_scan`).
  - `modules/changes/pages/index.tsx` + `src/components/changes/change-history-list.tsx` + `src/components/changes/proposal-row.tsx`: route search schema accepts `id`; the page auto-switches to History when the linked proposal isn't pending, scrolls the matching row into view, and adds a 2.4s ring highlight (latched via `useRef` per `(highlightId, tab)` so realtime refetches don't re-fire). `ProposalRow`'s root went from `<li>` to `<div>` and the call sites wrap with `<li data-proposal-id>` so the structure stays valid.
  - `wake/observers/workspace-sync.ts`: `WorkspaceSyncOpts` gains `conversationId` and the proposal write threads it through to `insertProposal` (was hardcoded `null`, which silently dropped lifecycle events for agent-driven edits).
  - `wake/build-base.ts` + `wake/conversation.ts` + `wake/standalone.ts`: `composeHooks` accepts an optional `coreToolResults: OnToolResultListener[]` array; both lane builders thread the new sensitive-write-warner through it.
  - `wake/prompt.ts`: static instructions gain a `## Bash sandbox` section listing the WebContainer toolchain (no `python`/`node`/`jq`/`yq`/`perl`/`ruby`) plus `sed`/`echo`/here-doc patterns for frontmatter edits with explicit insert-or-replace examples (a new contact's frontmatter often only has `displayName`+`marketingOptOut`, so a "replace existing key" sed silently no-ops on absent fields). Plus a `## When the customer asks you to write something` order-of-operations rule (attempt the write → cat to verify → read stderr notice → reply based on what the notice actually said).
  - `modules/contacts/agent.ts`: AGENTS.md fragment for `contacts.contact-context` gains a 5-step workflow ("when the customer asks for a profile change") that explicitly forbids "logged for review" replies without a verified upstream edit.
  - `runtime/bootstrap.ts`: registers the new `CHANGES_DECIDED_TO_WAKE_JOB` handler.

  **Manual smoke (lifecycle):**

  ```bash
  # Same dev-server prereqs as above.
  bun -e '
    import { open, sendInbound, waitForReply, insertPending, decide, listActivity, close } from "./packages/template/tests/helpers/changes-smoke"
    const ctx = await open({ from: `smoke-${Date.now()}` })
    const conv = await sendInbound(ctx, "Quick question about your team.")
    await waitForReply(ctx, conv.conversationId, 0)
    const pid = await insertPending(ctx, { contactId: conv.contactId, conversationId: conv.conversationId, field: "email", value: `marc.${Date.now()}@example.com`, rationale: "Customer asked to update email on file" })
    await decide(ctx, pid, "approved")
    await waitForReply(ctx, conv.conversationId, 1)
    console.log(await listActivity(ctx, conv.conversationId))
    await close(ctx)
  '
  ```

  Expected: `change.approved` activity row carrying `summary: "Email change to …"` + `proposalId`; agent posts a brief customer-facing confirmation reply on the next wake.

  ## propose_contact_update — first-class tool for customer-asked profile edits

  Closes the agent-tool-discipline gap that surfaced during the lifecycle smoke: with bash-edited `profile.md` as the only path, `gpt-5.4` (and Sonnet, tested via single-line model swap) reliably skipped the bash sed for customer-asked profile updates and replied with a hallucinated "logged for review" — silently breaking the propose pipeline (no `change_proposals` row, no journal event, no staff inbox entry, no `sensitive-write-warner` notice). 5 consecutive baseline runs produced 0 proposals; 4 prompt iterations did not move the model.

  **New surface:**

  - `modules/contacts/tools/propose-contact-update.ts` — conversation-lane, customer-facing tool. `audience: 'customer'`, `lane: 'conversation'`. Resolves `contactId` from `ctx.conversationId` (the model can't pick the wrong contact). Input is `{patch, rationale}` where `patch` accepts `{displayName, email, phone, segments, marketingOptOut, attributes}`; `attributes` is a flat map flattened to `attributes.*` field_set keys server-side. Builds the `field_set` diff against the current row, reuses `buildFieldSetCopy` for `expectedOutcome`, and forwards the model's `rationale` verbatim to `insertProposal`. Returns `{proposalId, status, fieldsTouched, replyHint}` where `replyHint` is one of three deterministic strings keyed off `status`:
    - `auto_written` → "Tell the customer the change is done (it applied immediately and is now on file)."
    - `pending` → "Tell the customer it's logged for our team to review (a gated field was touched)."
    - `no_op` → "No values would change — the patch you proposed already matches what's on file."
      Idempotent on rapid double-call: a duplicate-pending conflict from `insertProposal` collapses to `{status: 'pending', proposalId: null}` rather than re-throwing, so the model still gets a deterministic answer.
  - 7 unit tests in `modules/contacts/tools/propose-contact-update.test.ts`. Uses `mock.module('@modules/changes/service/proposals', …)` because `wake/observers/workspace-sync.test.ts` and `wake/observers/learning-proposals.test.ts` already mock that module process-wide; an `installChangeProposalsService` stub would silently lose to their `mock.module` replacement.

  **Changed:**

  - `modules/contacts/agent.ts`: registers `proposeContactUpdateTool` in `contactsTools` and rewrites the `contacts.contact-context` AGENTS.md fragment to lead with the tool. The 5-step bash workflow is replaced with a 3-step tool workflow ("call `propose_contact_update`; read the returned `status`; reply accordingly"). Bash-editing `profile.md` is demoted to operator/admin workflows; the fragment explicitly tells the agent that bash-as-customer-shortcut is silently ignored.

  **Verified.** Re-running the same gpt-5.4 baseline smoke after the fix:

  | Runs       | bash calls | proposals created | journal events        | reply matches reality          |
  | ---------- | ---------: | ----------------: | --------------------- | ------------------------------ |
  | Before fix |      0 / 5 |             0 / 5 | none                  | "logged for review" — false    |
  | After fix  |      0 / 4 |         **4 / 4** | `change.proposed` × 4 | "logged for review" — **true** |

  Plus a non-gated phone-update run that auto-wrote (`status=auto_written`, `contacts.phone` updated to the new value) and the agent replied with the corresponding "all set" copy.

### Patch Changes

- [`7776abf`](https://github.com/vobase/vobase/commit/7776abf49c838c6e1d86227917782a6a516075d4) Thanks [@mdluo](https://github.com/mdluo)! - # Tint composer background when in internal-note mode

  The inbox composer uses a single `PromptInput` for both customer reply and internal-note modes, distinguished only by the active tab. Switching to **Note** changed the placeholder and submit label but left the input box visually identical to a customer reply, so it was easy to mistake one for the other at a glance.

  Match the composer surface to the note message bubble (`bg-amber-50/70` light, `bg-amber-950/25` dark, `border-amber-500/30`) when `mode === 'note'`. Reply mode is unchanged. Same color tokens already used by `NoteRow` in `message-thread.tsx`, so the composer reads as a draft of the bubble it will produce.

- [`9bc15cd`](https://github.com/vobase/vobase/commit/9bc15cd3443d8bf126601e5e58b86232cbabbfa9) Thanks [@mdluo](https://github.com/mdluo)! - # Full-height Drive on detail pages, agent page joins side-by-side layout

  Three follow-ups to the contact/team detail-page rework:

  - **Agent detail page now uses the same two-column layout.** Settings + Save on the left, vertical-orientation Drive on the right. Save button is contextual — only renders while the form is dirty.
  - **Drive panel fills the column on `lg+`.** Detail pages flip `PageBody` to `flex flex-col` and the grid container to `flex-1` so the right column claims all remaining vertical space; `DriveSection` takes `lg:h-full` to override the default `h-[60vh]`. Below `lg` Drive keeps the original 60vh box. Left column gets its own internal scroll if its sections exceed the available height.
  - **Vertical Drive prefers content over file list.** When `orientation="vertical"` and a file is selected, the grid splits the panel `1fr` for the file list and `2fr` for the preview/editor (was `1fr/1fr`), so AGENTS.md / PROFILE.md / etc. get the room they need without shrinking the file list to nothing.

- [`9555875`](https://github.com/vobase/vobase/commit/95558755e1dbc30460fd2530b989333f43670f69) Thanks [@mdluo](https://github.com/mdluo)! - # Side-by-side detail pages with vertical Drive

  The contact and team detail pages now use a two-column layout on `lg` and up: identity sections on the left, the entity's Drive on the right. The previous stacked layout pushed Drive below the fold whenever the attributes list grew.

  **Two sections per entity, one role each.** Native fields (Email/Phone/Segments/Marketing on contacts; Title/Availability/Capacity/Sectors/Expertise/Languages on staff) sit in a read-only `InfoCard` with an Edit button that opens the existing form dialog. Custom attributes sit in their own `InfoCard` with inline-editable rows, dirty-tracking, and a contextual `Save (N)` button that only appears while a field is dirty.

  **Add new attributes from the detail page.** A `+ Add attribute` row at the end of the attributes card opens the existing `AttributeFormDialog` to create a new definition, which appears on every contact/staff member via query invalidation — no detour to `/contacts/attributes` or `/team/attributes` for one-off fields.

  **Drive can stack vertically.** `DriveBrowser` takes a new `orientation: 'horizontal' | 'vertical'` prop; `vertical` switches the desktop grid from columns to rows so the file list sits on top and the preview stacks below. Detail pages pass `vertical` so Drive fits in a single right-column box; the standalone `/drive` page keeps the original horizontal split.

  Other cleanup: removed the staff `Profile` field from the dialog (already covered by `/PROFILE.md` inside Drive), dropped the unused module-level `attribute-table` wrappers and the shared `src/components/attributes/attribute-table.tsx`, and removed the "Settings" section heading on the agent detail page so its `InfoCard` matches the other detail pages' style.

- [`466ff11`](https://github.com/vobase/vobase/commit/466ff1187e960443a753c717e46d543284a9ca92) Thanks [@mdluo](https://github.com/mdluo)! - # Memory hygiene: budget headers, capture triggers, scope conventions

  Revamp how the agent harness instructs and budgets `MEMORY.md` across all three scopes (agent self / contact / staff).

  **AGENTS.md additions** — three new sections compose into every wake's AGENTS.md:

  - `agents.self-state` (priority 20, trimmed) — file locations only, no longer carries capture imperatives.
  - `agents.memory-capture-triggers` (priority 25) — "## When to capture" with the auto-loop reframe (do NOT echo `internal_note_added` / supervisor coaching; the self-learn loop captures those automatically). Lists keywords (`always`, `never`, `from now on`, `remember that`, `next time`) for mid-wake self-lessons only.
  - `agents.memory-conventions` (priority 26) — three-row scope table (agent / contact / staff) with paths, when-to-write, append + sed mutation patterns, and a 30-day prune rule.

  **Per-wake budget header** — every materialized `MEMORY.md` gains a deterministic `<!-- memory-budget scope=... id=... chars=N (utf16) cap=8000 over=true|false -->` line as a soft visibility hint. Header is render-time only and `stripBudgetHeader` keeps storage clean (no header round-trip into the DB column on workspace-sync flush). Header surface is capped to the first 5 staff ids per wake (`STAFF_BUDGET_HEADER_CAP`); body materialization still iterates all `staffIds` so the workspace surface is unchanged.

  **Self-learn loop fix** — `Note: —` empty-body bug in the `## Staff signal —` block that the `learning-proposals` observer appends. The supervisor wake's `agent_start` payload only carries `noteId`; the observer now looks up the body via `listNotes(conversationId)`, capped at 800 chars, so the captured rule actually surfaces in working memory.

  **Determinism** — `wake/memory-budget.ts` is byte-pure (source-regex guard bans `Date`, `Math.random`, `process.env`, `os.hostname`, `__dirname`, etc.). Cross-wake `systemHash` stability test added to `wake/prompt.test.ts` covering all three scope headers reaching the rendered system prompt.

  **Tests** — 79 passing across `wake/memory-budget.test.ts`, `wake/observers/workspace-sync.test.ts`, `wake/observers/learning-proposals.test.ts`, `modules/{agents,contacts,team}/agent.test.ts`, `wake/prompt.test.ts`, `wake/build-base.test.ts`. Live smoke verified the GK Corp regression bug (customer-volunteered facts now persist to `/contacts/<id>/MEMORY.md`).

## 3.5.0

### Minor Changes

- [`927b0ea`](https://github.com/vobase/vobase/commit/927b0eaf87d705554f78b1956e77e204f10972fe) Thanks [@mdluo](https://github.com/mdluo)! - # Fix: managed-mode WhatsApp end-to-end wire delivery

  Customer messages reaching the agent via the platform-managed WhatsApp sandbox produced agent replies that landed in the inbox UI but never reached the customer's WhatsApp. Diagnosis surfaced two independent bugs at the egress boundary plus three smaller papercuts around sandbox claim ergonomics.

  ## What changed

  ### Identity vs. external keys (`@modules/contacts`)

  Inbound contact resolution stamped a canonical `${channel}:` prefix onto `contacts.phone` (so `whatsapp:6512345678` instead of `+6512345678`) to keep external keys non-colliding across channels. Outbound dispatch then handed that prefixed value verbatim to `adapter.send({ to })`, and Meta's Graph API silently rejected the malformed recipient — agent reply persisted, wire never fired.

  The fix splits identity from per-channel dedup keys.

  - **New table** `contacts.contact_external_keys (org_id, channel, external_key, contact_id)` with PK on the triple, index on `contact_id`. Inbound dispatch resolves the contact via this table.
  - **`contacts.phone` and `contacts.email` are now bare canonical identity** (E.164 with leading `+`, lowercased RFC email) — no channel prefix. Outbound reads them directly with no stripping.
  - **New normalizers** `normalizePhoneE164` (strip non-digits, prepend `+`, length-bound 7–15) and `normalizeEmail` (trim + lowercase) in `modules/contacts/service/identity-normalize.ts`. Light-touch, no `libphonenumber-js` dep — forks that need region-aware validation can compose their own.
  - **`upsertByExternal` → `upsertByExternalKey`** with shape `{ organizationId, channel, externalKey, phone?, email?, displayName? }`. Lookup chain: existing key row (single `INNER JOIN`) → existing contact by `phone` or `email` for cross-channel merge → fresh contact + key row. Idempotent key insert with re-fetch handles concurrent inbound races.
  - **Inbound dispatch** reads `adapter.contactIdentifierField` to decide whether `event.from` is a phone (normalize → store as `phone` AND key), email, or opaque session token (key only, no phone/email). Adapter resolution now throws on unknown channel instead of silently treating raw `event.from` as the dedup key.

  `packages/template/modules/contacts/seed.ts` is unchanged — the seed contacts already used bare `+E.164` phones; the prefix scheme was an inbound-only convention.

  ### Tenant signing for managed-mode outbound (deferred to platform fix)

  The tenant-side outbound signing was correct end-to-end. The platform's `verifyTenantSignature` middleware was using tenant-level HMAC for verification while the platform's own forwarded webhooks used per-channel claim secrets — causing every outbound graph proxy call to 401 with `Invalid signature (v2)`. That asymmetry is fixed in `vobase-platform` (separate commit); no further tenant change required.

  ### Sandbox-claim ergonomics

  - `claim-sandbox-dialog.tsx` no longer gates the "Claim sandbox" button on `availability > 0`. The platform's `allocateManagedChannel` is idempotent on `(tenantSlug, environment, channelInstanceId)` and self-heals orphan claims; gating the click would make those self-heal paths unreachable for any tenant whose `/health` reports zero free slots due to a stale claim row.
  - `handshake.ts::fetchSandboxAvailability` now throws `PlatformHandshakeError('platform_unauthenticated')` when the platform's `/health` strips data fields due to HMAC verification failure, instead of returning `{ sandboxPoolAvailable: 0 }` and masquerading as pool exhaustion. The dialog now shows the actual auth-failure reason.
  - `channel-row-menu.tsx` web variant now wraps the dropdown trigger in a `flex items-center justify-end` container to match the WhatsApp variant — fixes misaligned menu buttons in the channels table.

  ### Tests

  - New `identity-normalize.test.ts` covers length bounds + null/empty rejection.
  - `echoes.test.ts` and `webhook-routing.test.ts` register a stub WhatsApp adapter via the registry now that inbound dispatch hard-errors on missing adapter.
  - `wake/workspace/create.test.ts` and `web/tests/inbound.test.ts` updated for the renamed method.

  ## Migration

  Schema changes mean `bun run db:reset` is required after pulling this. There's no in-place migration — projects forked from the template before this should: pull the new `contacts/schema.ts` + `contacts/service/`, run `db:reset`, and re-pull `channels/service/inbound.ts` + `channels/adapters/web/handlers/inbound.ts` to use the new service shape.

  ## Deferred

  - E.164 region-aware normalization (Brazil 12↔13-digit, etc.) — channel adapters with region quirks should compose their own normalizer over `normalizePhoneE164`.
  - Cross-channel merge race window — relies on the existing `(orgId, phone)` unique index surfacing as a hard error if two concurrent inbounds race to create the same contact. Closing the window cleanly would need a wrapping transaction with `SELECT ... FOR UPDATE`; out of scope for a scaffold.
  - Contact form normalizer divergence — `contact-form-dialog.tsx` still trims raw input; aligning with `normalizePhoneE164` would close a future-state where a form-entered phone could mismatch an inbound-resolved phone for the same person.

### Patch Changes

- [#71](https://github.com/vobase/vobase/pull/71) [`27490cf`](https://github.com/vobase/vobase/commit/27490cfa091248033ef194e57efb3aa4a4734eca) Thanks [@TheSoggy](https://github.com/TheSoggy)! - # Drop epoch-stamped skip cache from test-db helper

  `tests/helpers/test-db.ts` cached `bun run db:reset` results via a 5-second `RUN_EPOCH` sentinel — files whose `beforeAll` landed within the same epoch as a successful reset would skip resetting. Sound for deduplicating parallel-worker setup, but unsound for tests that mutate seed rows: any DELETE/UPDATE in one file polluted the seeded DB for every later file inside the same epoch window. Manifested as order-dependent FK violations (`messaging.conversations.contact_id → contacts.contacts(id)`) and an anonymous `(unnamed)` mid-suite `db:push failed` whose 5-second duration matched the epoch bucket.

  Drop the cache. Every test file's `beforeAll` now reseeds unconditionally under the existing flock. No DB-lifecycle issues — `bun run db:reset` works fine even when other test processes hold open `postgres` connections (verified empirically with sequential subprocess invocations).

  **Suite impact**: 0 failures (was 4); 67-71s runtime (was ~8s, but with 4 polluted-state failures). Stable across 3 consecutive runs. If suite latency becomes a concern, the next iteration is in-process `TRUNCATE ... CASCADE` + reseed using the existing module `seed(db)` exports — same correctness, sub-second per file.

  Resolves [#69](https://github.com/vobase/vobase/issues/69).

- [`8cdbb57`](https://github.com/vobase/vobase/commit/8cdbb57daf4dac65391cae6dfea7656f681175c6) Thanks [@mdluo](https://github.com/mdluo)! - # WhatsApp card rendering, agent handoff UX, and supervisor coaching fixes

  Six related fixes uncovered while debugging local-chat conversations on the
  managed-WhatsApp sandbox.

  **WhatsApp `send_card` now renders all child elements.** Outbound dispatch
  previously squashed cards to `title + subtitle`, dropping every `fields`,
  `text`, `link`, `image`, `divider`, and `link-button` child. The new
  `cardToOutbound` helper walks card children in order and emits a real
  `metadata.interactive` payload — `type=button` for ≤3 reply buttons,
  `type=list` for 4–10. Non-WhatsApp channels fall back to plain text. Footer
  is intentionally not auto-promoted from a trailing text child (the schema has
  no footer signal and any heuristic misclassifies normal prose).

  **Web inbox card buttons are read-only for staff.** The web `MessageCard`
  now threads a `readOnly` prop down to `CardActions`; the staff inbox passes
  it (`message-thread.tsx`), so buttons render disabled and never POST a
  card-reply. The first reply button's `primary` style maps to `default` on
  web — leading-button emphasis is a WA/Teams renderer convention that read as
  a bug in the inbox.

  **Agent → human reassignment requires a customer-facing acknowledgment.**
  Adds `messages.hasRecentAgentReply(conversationId, withinSeconds)` and gates
  `conv reassign --to=user:<id>` on it: the verb refuses with
  `errorCode: 'no_customer_ack'` if the agent hasn't sent a `reply` /
  `send_card` / `send_file` in the last 60 seconds. Verb description and
  `prompt` rewritten as a 3-step handoff playbook so the agent is told
  explicitly to acknowledge BEFORE flipping the assignee.

  **Managed-WhatsApp adapter no longer races vault load.** The previous
  `void loadRotation(...).catch(swallow)` warm-load could resolve after the
  first outbound, throwing "vault not yet loaded" on the wire. The factory
  now awaits the initial rotation load; `loadRotation` deduplicates concurrent
  calls so subsequent adapter constructions for the same org pay an in-memory
  hit. `ChannelAdapterFactory` now accepts `Promise<ChannelAdapter>`;
  `registry.get()` is async; every caller (`outbound`, `inbound`,
  `mention-notify`) awaits.

  **Supervisor coaching wakes get a clearer playbook.** `wake/trigger.ts`
  leads with `cat <conv>/internal-notes.md` so the model can't treat reading
  the staff note as optional, then directs the agent to capture a durable
  lesson in MEMORY.md. `wake/prompt.ts` reorders the system prompt so
  `MEMORY.md` (renamed to "## Active lessons — apply these rules on every
  reply") sits before AGENTS.md — durable rules ahead of static guidance.
  `learning-proposals.ts` skips signals whose `notePreview` is present-but-blank
  to avoid `Note: —` stubs.

  **`agents.agent_threads*` renamed to `operator_threads*`** to disambiguate
  from `harness.threads` (the conversation lane). Schema, seeds, services,
  handlers, the standalone wake builder, and the operator-chat component all
  updated atomically. No data migration — template scaffolding only.

  Includes test coverage: `outbound-card.test.ts` (13 cases for WA interactive
  shapes, fixture, fields/link-button, truncation, no-footer assertions);
  `conv-reassign.test.ts` (4 cases covering happy path, block, staff bypass,
  agent-target bypass); `messages.test.ts` extensions for `hasRecentAgentReply`;
  `learning-proposals.test.ts` for the empty-note skip; thread test updates
  for the rename.

## 3.4.0

### Minor Changes

- [`e3d4817`](https://github.com/vobase/vobase/commit/e3d48170834b8be36413c7dcd8bee3cc14f0411e) Thanks [@mdluo](https://github.com/mdluo)! - # Changes module: history audit log + self-learn observer

  The changes module previously only surfaced **pending** proposals. Once a staff reviewer approved or rejected one, the row simply vanished — no audit log, no "applied to /policies/refunds.md" feedback, no way to answer "who decided this and when?". And the self-learn loop was incomplete: `detectStaffSignals` was implemented and tested but no observer ever invoked it, so a staff `@`-mention or reply triggered a supervisor wake without ever turning into a memory entry the next wake could see.

  ## What changed

  ### `/changes` — Pending | History tabs

  A new `<Tabs>` shell on `/changes` with URL-state via `validateSearch({ tab: z.enum(['pending','history']).optional() })`. The Pending tab keeps the existing FilterChip + ProposalRow grid. History adds:

  - Day-grouped sticky headers (TUE 5 MAY · MON 4 MAY · …)
  - Status filter chips: All / Approved / Rejected / Auto-applied
  - Compact `<HistoryRow>` per decision with status badge, proposer + decider principals, headline target, and an expandable Problem / Outcome / Diff / decision-note panel
  - Live-updates via the existing realtime SSE invalidation; no polling

  ### `GET /api/changes/history`

  New route on the changes module, gated by `requireOrganization`. Query params: `resourceModule?`, `status?` (any `ChangeStatus | 'all'`), `limit?` (1–500, default 100). Backed by `listDecided(organizationId, opts)` on `ChangeProposalsService` — returns proposals where `status IN ('approved','rejected','auto_written','superseded')` ordered by `COALESCE(decided_at, created_at) DESC`, with the same conversation→contactId join as the inbox so rows can render a clickable contact pill.

  ### Approve / reject feedback

  `<ProposalRow>` now fires a sonner toast on success: **"Change applied · `<resource>` updated · View in history"** for approve, **"Change rejected · Logged to history · View in history"** for reject. The action button navigates to `/changes?tab=history`. Approve/reject buttons disable when no authenticated user is present so the audit trail can never contain a fabricated principal — the previously-shipped `'staff:current'` literal fallback is gone.

  ### Self-learn loop closed

  New `wake/observers/learning-proposals.ts` wired into both `wake/conversation.ts` and `wake/standalone.ts`. At `agent_end` it runs `detectStaffSignals` on the per-wake event buffer and, for each non-trivial signal (supervisor / approval-rejected / internal-note from a staff author — `reassignment_note` is intentionally skipped because the agent never saw it), files an `auto_written` proposal on `agents:agent_memory` with a structured markdown-append body capturing author + ref + note preview. Because `agent_memory` is registered with `requiresApproval: false`, the proposal materializes immediately and lands in History as audit — no staff click required, but every learning is reviewable after the fact.

  The observer only buffers `agent_start` / `internal_note_added` / `agent_end` events (not `message_update` / `llm_call` / `tool_*` — hundreds per turn) and cleans its buffer on `agent_aborted` to prevent leaks on aborted wakes. Duplicate-pending conflicts are swallowed; everything else surfaces via `logger.error`.

  ### Service correctness

  `insertProposal`'s duplicate-pending check is now scoped to pending-status inserts only. Auto-writes (`requiresApproval: false`) used to fail when an unrelated `pending` row existed on the same target — they now insert cleanly because the partial unique index only covers pending rows anyway.

  ### Smaller cleanups

  - Centralized `CHANGE_STATUS_VALUES` const-tuple in `modules/changes/schema.ts` so handlers + hooks share one source of truth instead of inlining the union
  - `or(...statuses.map(eq))` → `inArray(status, …)` in `listDecided`
  - Extracted `<HeadlineTarget>` and `<ProsePanel>` into `src/components/changes/` — they were previously byte-identical between proposal-row and history-row
  - `useChangeHistory` queryKey uses primitives + `staleTime: 30_000` instead of polling every 30s

  ## Seed updates

  `modules/changes/seed.ts` now seeds five decided proposals (`PROP_APPROVED_SLACK`, `PROP_REJECTED_AGGRESSIVE`, `PROP_AUTO_DEREK`, `PROP_AUTO_AGENT_MEM`, `PROP_REJECTED_PRICEDROP`) so the History tab is non-empty on a fresh `bun run db:reset` and exercises every status variant.

### Patch Changes

- [`7c8fe1d`](https://github.com/vobase/vobase/commit/7c8fe1d06cdf30930e2c9af6b14f3198517c8474) Thanks [@mdluo](https://github.com/mdluo)! - # Fix: outbound dispatch + media + tenant scope

  Agent replies (`reply`, `send_card`, `send_file`) and staff replies were persisted to the inbox but never reached the wire — both owned and managed (platform-proxy) WhatsApp. The web channel masked the bug because its `send()` is a no-op (the realtime push from the row insert delivers to browsers, but no Graph API call is ever made for WhatsApp).

  ## What changed

  ### `sendOutbound` seam wired end-to-end

  A new install-time service (`installOutboundService`, mirroring the `installMessagesService` pattern) is the single seam for outbound delivery. After persisting their message row, `reply.ts`, `send-card.ts`, `send-file.ts`, and `staff-reply.ts` now call `sendOutbound`, which resolves the channel adapter via the registry, enforces the 24h messaging window for windowed channels, and calls `adapter.send()`.

  Adapter resolution is **instance-keyed** — `registryGet(channel, config, instance.id)` — which is what makes managed-mode WhatsApp actually deliver. The managed adapter is constructed bound to the instance's vault rotation so the platform proxy receives correctly-signed requests.

  ### Cross-tenant assertion

  `SendOutboundInput` now requires `organizationId`. Inside `sendOutbound`, every conversation/contact/instance lookup asserts `row.organizationId === input.organizationId` before proceeding. Closes a cross-tenant exfiltration primitive: a wake on `org-A` could previously pass a `conversationId` from `org-B` (e.g. via prompt injection in customer content) and reach `org-B`'s wire signed with `org-B`'s vault keys.

  ### Channel-aware recipient

  The previous `contact.phone ?? contact.email ?? contact.id` fallback could send a nanoid as the wire address. `sendOutbound` now reads `adapter.contactIdentifierField` and throws cleanly if the contact lacks the required handle for that channel — no more silent message-loss for contacts missing a phone number.

  ### Real media support for `send_file`

  `send_file` now resolves the drive row via `filesServiceFor(orgId).get(driveFileId)`, downloads bytes via `getDriveStorage().bucket('drive').download(storageKey)`, maps the mime type to `image | video | audio | document`, and ships a real `OutboundMessage.media[]` payload. The WhatsApp adapter's existing bytes-upload path (`sendMedia` → Graph `/PHONE_ID/media` → upload id) handles the rest.

  A scope check rejects sending another contact's private file: the drive file must be `organization`-scoped, or `contact`-scoped to the conversation's contact, or `agent`-scoped to the current agent. Closes a within-tenant lateral-access path where prompt injection from contact-X could leak contact-Y's private upload from the same org.

  Virtual files (no `storageKey`, e.g. `MEMORY.md` overlays) throw cleanly.

  ### `SendResult` failures surface to the agent

  A new `throwIfFailed(result, toolName)` helper bubbles `success: false` outcomes out of every tool. `code === 'window_expired'` throws with a template-fallback hint (`Messaging window expired — fall back to a pre-approved template`); other failures bubble `code` + `error`. Replaces the silent `await sendOutbound(...)` that swallowed Graph 5xx and window-expired short-circuits.

  ### Declarative per-adapter platform hints

  Each channel adapter now owns its prompt hint alongside `agent.ts`:

  | Adapter                                       | Export                 |
  | --------------------------------------------- | ---------------------- |
  | `modules/channels/adapters/web/agent.ts`      | `webPlatformHint`      |
  | `modules/channels/adapters/whatsapp/agent.ts` | `whatsappPlatformHint` |

  The umbrella `modules/channels/agent.ts` aggregates `platformHints: HarnessPlatformHint[]`, and `wake/platform-hints.ts` is now a thin registry built from that list. Adding a new channel adapter only touches its own folder. Vestigial `email`/`sms`/`voice` entries removed since no adapters back them today — re-add them in their adapter folder when wired.

  ## Tests

  Test stubs for the four sender paths now use counted-spy fakes that assert `sendOutbound` was called with the right `(toolName, organizationId, conversationId)`. A regression test for `window_expired` confirms the failure-path bubbles a tool error mentioning the template fallback. A regression on the wire path can no longer pass.

  ## Migration

  No schema changes. No new dependencies. No new pg-boss jobs. The `installOutboundService` call lands in `modules/channels/module.ts::init` — projects scaffolded from this template before this fix should re-pull the channels module init or call `installOutboundService(createOutboundService())` themselves at boot.

  `ChannelOutboundEventSchema` was removed from `runtime/channel-events.ts` (no remaining consumers); inbound schema and `OUTBOUND_TOOL_NAMES` retained.

  ## Deferred

  The following were intentionally scoped out and remain follow-ups:

  - `send_card` → real WhatsApp interactive payload (buttons / list pickers); currently flattens to plain text.
  - `messages.status` state machine (`queued → sent → failed`) + delivery retry queue.
  - E.164 normalization on WhatsApp `to:` at the egress boundary.
  - Managed-mode env-fallback regression-guard (a config row that loses `mode: 'managed'` currently falls back to env-var creds).
  - `runThreatScan` is still a `return { ok: true }` stub on the `send_file` path.
  - `staff_reply` attachments persist on the row but only the text body flows to the wire.
  - `installOutboundService` cross-test bleed sweep (pre-existing pattern across all `install*` services).

- [#67](https://github.com/vobase/vobase/pull/67) [`fb8f6bd`](https://github.com/vobase/vobase/commit/fb8f6bd3d5a724b124a187b70307cacdf14531c6) Thanks [@TheSoggy](https://github.com/TheSoggy)! - # Fix theme FOUC bootstrap and echoes test setup

  Two unrelated, mechanical fixes from running the unmodified scaffold:

  **`index.html` theme bootstrap reads stale storage key.** The pre-paint FOUC-prevention script in `index.html` reads `localStorage.getItem("template-v2-theme")`, but `theme-provider.tsx` (and its test) write/read `vobase-theme`. This causes the bootstrap script to never find a saved preference and always default to `system`, producing a real flash on hydration for users who'd selected `light` or `dark`. Aligns the bootstrap with the actual storage key.

  **`modules/channels/adapters/whatsapp/echoes.test.ts` missing contacts service install.** The test's `beforeAll` installs `conversations`, `messages`, `sessions`, `reactions`, and `channels` services but never installs `contacts`. Because `dispatchInbound` → `contacts.upsertByExternal` reads the contacts singleton, every test in the file throws `contacts/contacts: service not installed`. Adds the install matching the canonical pattern in `tests/helpers/attachments-fixture.ts`.

  After these fixes: 1 previously failing test goes green (theme FOUC), and the `smb_message_echoes` tests pass cleanly when the file is run in isolation. (The echoes tests still fail in the full-suite run due to a separate cross-test DB-state pollution issue — filing a separate report.)

## 3.3.0

### Minor Changes

- [`2964598`](https://github.com/vobase/vobase/commit/2964598ecf41eec727df4329be1132228b9421ab) Thanks [@mdluo](https://github.com/mdluo)! - # Drive (Upload + OCR) and WhatsApp Channel

  Two end-to-end template features ship together, both already exercised by the canonical helpdesk scaffold.

  ## Drive: upload, OCR, and inbound auto-ingest

  The `drive` module is now a real agent filesystem. Staff and inbound channels both write through one `ingestUpload(input)` seam; readable artifacts are normalized to `.md` so the agent's bash sandbox can grep them.

  - **Storage seam.** `ModuleInitCtx` now carries `storage: StorageAdapter` (local in dev, S3/R2 in prod). Modules consume a single adapter; no per-module file plumbing.
  - **Upload pipeline.** `drive:process-file` job extracts text per mime, with a per-page readability gate for PDFs (`MIN_READABLE_CHARS_PER_PAGE = 40`, `MIN_PRINTABLE_RATIO = 0.6`) — pages that fail the gate are routed through OCR rather than trusting watermark glyphs.
  - **OCR provider.** `lib/ocr-provider.ts` uses `@ai-sdk/openai` directly via `provider.chat(...)`. Bifrost mode → `google/gemini-2.0-flash`; direct mode → `models.gpt_mini`. Provider + `generateText` memoized so an N-page PDF reuses one handle.
  - **Hybrid search.** New `drive_chunks` table backs pgvector + tsvector hybrid search. Post-rank phase batches chunk → file lookups (2 SELECTs total for a 10-hit search; pinned by `files-search.test.ts`).
  - **Caption + binary stub.** Every file carries a deterministic 120-char `caption` projection (no LLM on the hot path). Binary files get a stub row plus the agent's new `request_caption` tool, which fires a `caption_ready` wake when extraction completes.
  - **Cost ceilings.** Per-org daily budget gate at `modules/drive/service/budget.ts` reads `harness.tenant_cost_daily`. Jobs past the ceiling fail with `processingError = 'org_daily_budget_exceeded'` rather than uncapped spend.
  - **Inbound auto-ingest.** WhatsApp inbound media (`MessageReceivedEvent.media[]`) auto-ingests under `/contacts/<id>/<channelInstanceId>/attachments/`. `messages.attachments` jsonb carries refs; `messages.md` materializer renders inline caption blocks per attachment.
  - **Loser-of-race reap.** Concurrent webhook redeliveries (Meta retries 5xx up to 7 times) call `filesService.reapAttachmentRows(...)` from `createInboundMessage` on `channelExternalId` unique-violation, so duplicate drive rows never persist.
  - **Drive UI.** `<DriveFileList>` gains drag-and-drop upload (folder-scoped overlay, multi-file with toast), per-row 3-dot menu (Rename inline, Delete via AlertDialog, Download original when display ext ≠ original ext), pending-uploads counter, status pill with `processingError` tooltip.
  - **Failure paths.** Post-storage UPDATE failure deletes the just-uploaded storage object and marks the row `(failed, failed)` with a structured `processingError`. `markFailed` and embedding-fail catch in `jobs.ts` log via `@vobase/core` logger so operators can grep stderr.
  - **Wake bus rename.** `INBOUND_TO_WAKE_JOB → AGENTS_WAKE_JOB`; pg-boss queue renamed to `'agents:wake'`. `WakeTriggerSchema` is `z.discriminatedUnion('trigger', [...])` with paired-shape compile-time drift guard.

  ## WhatsApp channel

  End-to-end Cloud API support across self-managed and platform-managed modes — see [`@vobase/core@0.36.0`](https://github.com/vobase/vobase/releases) for the underlying transport seam, envelope-encrypted vault, and 2-key HMAC sig v2 contract.

  Template-side surfaces:

  - **Embedded Signup.** `<WhatsAppSignupButton variant="hero" | "compact">` Facebook SDK launcher, server-side code exchange (`/signup/start` + `/signup/exchange`), nonce table bound to `(orgId, sessionId)` with 5-min expiry, mandatory `debug_token` validation, per-org rate limit (10/h), per-IP failure bucket (60/min).
  - **Coexistence.** `smb_message_echoes` parsed and persisted as `role='staff', metadata.echoSource`. Echoes do NOT enqueue wake jobs, do NOT open the 24-hour service window, do NOT fan out `add_note`.
  - **Platform-managed sandbox.** Tenant config carries only `{ mode: 'managed', platformChannelId, platformBaseUrl }` — zero Meta credentials at rest. TOCTOU-safe `upsertManagedInstance` via Postgres generated column + partial unique index.
  - **24-hour service window.** `messaging.conversation_sessions` tracks open sessions per `(conversationId, channelInstanceId)`. Outbound dispatcher precheck returns `SendResult { code: 'window_expired' }` instead of attempting a doomed send.
  - **Status FSM + reactions.** `messages.updateDeliveryStatus()` enforces `queued → sent → delivered → read` (no backward); `failed` terminal; never mutates `role`/`content`. Reactions write through new `messaging/service/reactions.ts` only — `check:shape` enforced.
  - **Doctor.** `vobase channels:doctor :instanceId` runs `debug_token`, `subscribed_apps`, `phone_numbers`, `message_templates`, surfaces results in `<InstanceDoctorSheet>` with red/amber/green pills.
  - **Channels admin UI.** Single unified `<ChannelsTable>` (DiceUI data-table) replaces the prior tile catalog. WhatsApp + Web channels coexist with a `<ModeChip>` per row. Row-action menu opens slide-over sheets for Doctor (WA), Templates (WA), Embed snippets (Web).
  - **CLI verbs.** `vobase channels:list`, `vobase channels:instance:show :id`, `vobase channels:doctor :id`, `vobase channels:templates:sync :id`.
  - **TRUST_PROXY_HOPS.** New env var defaults to `0` (ignore XFF) for prod safety. Operators behind a sanitizing proxy must set it explicitly.
  - **Admin role gating.** `getRequireAdmin()` lazy accessor enforces `owner | admin` on every signup/managed/doctor mutation route.

  ## Frontend bundle isolation

  `check:bundle` extended to forbid `~/runtime` imports from `src/**` so backend code (auth handles, db client, jobs) cannot leak into the browser bundle.

  ## Test coverage

  - 23 new test files spanning e2e (caption-ready wake, attachment auto-ingest, attachment failure/orphan, inbound redelivery, loser-of-race reap, full ESU flow), integration (managed transport, echoes, doctor, signup nonces), unit (sessions FSM, reactions, dispatch routing, request-IP `TRUST_PROXY_HOPS`), and live smokes (`bun run smoke:wa` covering inbound, outbound echo, doctor, templates).
  - 616 passing / 5 skipped / 1 todo at the end of the slice; 6 pre-existing failures (contacts service not installed in test env) unchanged.

  ## Operational notes

  - **Backfill:** ops needs to populate `tenant_environments` rows for existing managed tenants so the per-env webhook resolver targets the right `instanceUrl`. Falls back gracefully today.
  - **Open follow-ups (non-blocking):** `Reassign default…` row action wired but disabled (needs AssigneeSelect popover); `mergeContacts(...)` is a JSDoc-only skeleton; vault `previous` decryption is eager per read (bounded by 60s rotation cache TTL — optional lazy follow-up); WA-inbound live smoke deferred until `META_WA_*` configured in dev.

## 3.2.1

### Patch Changes

- Updated dependencies [[`02a1b87`](https://github.com/vobase/vobase/commit/02a1b87bfcab7645590802b04fbc7e0c57378568)]:
  - @vobase/core@0.36.0

## 3.2.0

### Minor Changes

- [`5c5c277`](https://github.com/vobase/vobase/commit/5c5c27784c91c96441918e0a5c42ace2b5833c77) Thanks [@mdluo](https://github.com/mdluo)! - End-to-end UI revamp of the template app: mobile-first shell, canonical layout
  and card primitives, and a Craft-style information-forward look.

  **Layout primitives.** New `PageLayout` / `PageHeader` / `PageBody` (in
  `src/components/layout/page-layout.tsx`) — every top-level page now slots into
  the same shell instead of hand-rolling section/header markup. Thirteen pages
  migrated. PageBody defaults to a subtle gray (`bg-muted/40`) with edge-to-edge
  horizontal padding; pages that want a centered column wrap their children in
  `mx-auto w-full max-w-4xl` so the gray field extends behind the cards.

  **Mobile-first AppShell + stack-and-push ListDetailLayout.** The shell renders a
  desktop rail or a mobile bottom-nav based on viewport. List/detail surfaces
  (inbox, team, contacts) push the detail pane onto a stack on mobile and reveal
  an inline chevron back affordance in `PageHeader`. Rail and conversation list
  are resizable + collapsible with persisted layout. Rail compacts at 80px
  (snap-collapsed icon-only width) instead of 160px, and active state is read
  from TanStack Router's `data-status="active"` attribute so the mobile
  bottom-nav highlight finally renders correctly. PRIMARY_NAV order: Inbox,
  Contacts, Agents, Changes, Drive.

  **Canonical card surface.** New `InfoCard` / `InfoRow` / `InfoSection` in
  `src/components/info` — `rounded-lg bg-background shadow-sm` with sibling
  dividers, no border. shadcn `Card` aligned to the same surface (override
  marker added). `SettingsCard` is now a thin alias. Pending-changes proposal
  cards drop their border to match.

  **Detail pages adopt InfoSection rows.** Contact, staff, and agent detail
  pages restructured around `InfoSection` + `InfoRow`, with native columns
  (email, phone, title, model, etc.) merged into the same surface as custom
  attributes — label-left, white card, tight rows.

  **Shared attribute primitives.** `AttributeTable` and `AttributeFieldControl`
  lifted to `src/components/attributes`; the contacts and team modules drop
  ~250 lines each of byte-near duplicate code in favor of 20-line bindings.
  Server values now merge per non-dirty key (rather than bailing when any field
  is dirty), and dirty entries whose definition has been removed upstream are
  dropped — so admin-side def deletions are no longer masked.

  **Drive section helper.** `DriveSection` consolidates the
  `DriveProvider` + `DriveBrowser` + fixed-height `InfoCard` triplet that the
  contact, staff, agent, and settings/account pages all repeated.

  **Design tokens + Tailwind defaults.** New foreground mix scale, shadow
  utility set, and z-index registry (`packages/template/src/styles`).
  `text-mini` / `text-compact` retired in favor of Tailwind's default text
  scale.

  **Settings consolidated to one page.** The `/settings/account` placeholder
  form is gone; the user-menu's top item is now a Profile link to the
  authenticated user's `/team/<userId>` detail page. The remaining tabs
  (Appearance, Notifications, API Keys) collapse into a single
  InfoSection-stack `/settings` page (no tabs), mirroring the contact-detail
  layout. `/settings` redirects to itself; the `account`, `profile`, `display`
  sub-routes are deleted along with their no-op POST endpoints
  (`/api/settings/account`, `/api/settings/appearance`, `/api/settings/display`).

  **Auto-save settings.** Notifications auto-save with a 400 ms debounce and a
  "Saving… → Saved → Save failed" indicator (toast on error). Theme + font
  size are now treated as client-only state (theme-provider + documentElement
  font-size) — no longer round-tripped through a stub server endpoint that
  swallowed the writes.

  **Real API keys.** The API Keys section was a placeholder POSTing to a
  no-op endpoint. It now goes through the existing `auth/api-keys` service
  (the same one that backs `cli-grant` for CLI device-grant auth):
  `GET /api/settings/api-keys` lists summaries (id, name, prefix•start,
  created, last-used), `POST` creates and returns the plaintext token once
  in a green reveal banner with a Copy button, `DELETE :id` revokes (and
  guards by ownership at the query). Tokens are sha256-hashed at rest and
  the `key` field is excluded from list responses (with a regression test).
  Created and last-used render via `RelativeTimeCard`.

  **Smaller polish.** Rail nav badge sizing (text-xs / h-5), Add web channel
  CTA size + 480px web preview track, redundant Drive list-page icon
  removed, list-page action button icons no longer force `mr-2 size-4`
  (`size=sm` slot spacing handles it).

## 3.1.0

### Minor Changes

- [`26f886c`](https://github.com/vobase/vobase/commit/26f886c3567ac1a85b4294efb3ecf1bd6dc805bf) Thanks [@mdluo](https://github.com/mdluo)! - Three connected changes to the template's agent-facing surface:

  **Audience tier model.** Verbs are now tagged with `audience: 'admin' | 'staff' | 'contact'`, and the AGENTS.md `## Commands` block + in-bash `vobase --help` filter to what the wake's tier can see. The wake's tier is derived from `(lane, triggerKind)`:

  | `(lane, triggerKind)`                                                        | tier        |
  | ---------------------------------------------------------------------------- | ----------- |
  | `conversation + inbound_message`                                             | `'contact'` |
  | `conversation + supervisor / approval_resumed / scheduled_followup / manual` | `'staff'`   |
  | `standalone + operator_thread / heartbeat`                                   | `'staff'`   |
  | `vobase` CLI binary with admin API key (outside the harness)                 | `'admin'`   |

  Per-tier verb tagging applied across `messaging`, `team`, `drive`, `contacts`, `schedules`, `agents`, `system`. `team list` / `team get` / `conv reassign` / `drive propose` are `'contact'`-tier (every wake sees them); `messaging show` / `messaging close` / `agents show` are `'staff'`; everything else (`install`, `drive cat`, `system/*`, etc.) defaults to `'admin'` and is hidden from wakes. Filtering happens at the surface (visibility), not at dispatch — the bash sandbox doesn't hard-reject admin-tier verbs today.

  **`add_note` extended with `mentions`; `conv ask-staff` removed.** The `vobase conv ask-staff` verb and the standalone `ask_staff` tool are deleted. Asking staff a question is now a parameter on `add_note`: pass `mentions: [<userId or displayName>, ...]` and the tool resolves each token against the staff roster, prepends `@DisplayName` tokens to the body, and writes `staff:<userId>` mention strings — the existing post-commit fan-out in `messaging/service/notes` enqueues a supervisor wake per mentioned staff. `conversationId` is now optional on `add_note` and defaults to the current wake's conversation; required only on standalone-lane wakes that need to leave a note on a different conversation. The mentions array is bounded (`maxItems: 16`, per-token `maxLength: 64`) and dedups same-staff references so neither `staff:u1` mentions nor `@Alice` body prefixes are duplicated.

  **AGENTS.md preview HTTP route + lane-aware scratch.** New `GET /api/agents/definitions/:id/agents-md?lane=<>&triggerKind=<>&supervisorKind=<>` route renders the AGENTS.md preamble the agent would see for a given lane variant, used by the agent-edit page's lane switcher. The Plate renderer for the preview was rewired to `BasicBlocksPlugin` + `BasicMarksPlugin` and now omits `remarkMdx` (which silently truncated AGENTS.md at the first JSX-like token, e.g. `<id>` / `<2k` / `<file>`). Cross-org guards added on all four `/definitions/:id*` handlers so a session-authenticated user from one org can't preview / read / mutate / delete another org's agent. The new `WakeAgentsMdScratch` (`wake/agents-md-scratch.ts`) carries `(lane, triggerKind, supervisorKind)` to module-side AGENTS.md contributors, replacing prose-in-instructions: messaging now contributes lane-aware blocks for supervisor-coaching, ask-staff-answer, and standalone-no-customer wakes. `MERIGPT_INSTRUCTIONS` was trimmed in `modules/agents/seed.ts` to remove the sections now framework-emitted (lane rules, MEMORY.md routing, supervisor-wake handling).

  Documentation: the template's `CLAUDE.md` "Agent harness" section now documents the canonical context names (`AgentContributions<WakeContext>` boot-time, `WakeContext` per-wake, "agent harness" as the informal term for `wake/`), the audience-tier derivation table, and a "Adding agent surfaces in a new module" recipe (declare `tools` / `materializers` / `agentsMd` / `roHints` on `agent.ts`; register verbs through `ctx.cli.register(...)` with the right `audience`).

## 3.0.0

### Major Changes

- Promote template-v2 to the default `@vobase/template`. The prior template is archived to `legacy/template-v1/` (frozen, pinned to `@vobase/core@0.33.0`).

  Breaking changes:

  - Imperative composition replaces declarative `vobase.config.ts`. Tenants customize storage / auth / channels by editing the template source.
  - WhatsApp env vars renamed from `WA_*` to `META_WA_*`.
  - Knowledge-base, automation, and integrations modules removed (use v1 if needed). Mastra removed; agents now run on `@mariozechner/pi-agent-core`.
  - Default dev DB DSN reverted to `:5432 / vobase`.
  - `STORAGE_KEY` for theme localStorage renamed; users see system-default theme on first load after upgrade.

  See `packages/template/CLAUDE.md` for the new module set and conventions.

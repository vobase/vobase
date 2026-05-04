# @vobase/core

## 0.36.0

### Minor Changes

- [`02a1b87`](https://github.com/vobase/vobase/commit/02a1b87bfcab7645590802b04fbc7e0c57378568) Thanks [@mdluo](https://github.com/mdluo)! - # WhatsApp Channel: Cloud API + Embedded Signup + Platform Sandbox

  End-to-end WhatsApp Cloud API support across self-managed (BYOC) and platform-managed (sandbox) modes, including Embedded Signup, coexistence echoes, 24-hour service window enforcement, status FSM, reactions, template lifecycle, and a per-instance doctor. Built on a new `WhatsAppTransportConfig` seam so direct (Meta) and managed (proxied) paths share one adapter.

  Ships alongside two new core primitives — envelope-encrypted secrets vault and a sliding-window rate limiter — that the channels work consumes but any module can use.

  ## WhatsApp Cloud API parity

  | Capability             | Surface                                                                                                | Notes                                                                                            |
  | ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
  | Direct mode (BYOC)     | `createDirectTransportConfig({ accessToken, appSecret })`                                              | Tenant holds Meta access token in encrypted integrations vault                                   |
  | Managed mode (sandbox) | `createManagedTransportConfig({ platformChannelId, platformBaseUrl, currentSecret, previousSecret? })` | Tenant holds only HMAC pair to vobase-platform — never a Meta token                              |
  | Webhook verify         | `WhatsAppTransportConfig.verifyInboundWebhook(req)`                                                    | Closes the prior `if (transport) return true` short-circuit; mode-specific verifier              |
  | 24h service window     | `messaging.conversation_sessions` + `outbound.ts` precheck                                             | Returns `SendResult { code: 'window_expired' }` instead of attempting send                       |
  | Status callbacks       | `messaging/service/messages.updateDeliveryStatus()`                                                    | Strict FSM `queued → sent → delivered → read`; `failed` terminal; never mutates `role`/`content` |
  | Reactions              | `messaging.message_reactions` + `messaging/service/reactions.ts`                                       | Single-writer; `check:shape` enforced                                                            |
  | Templates              | `templates.ts` CRUD + `vobase channels:templates:sync`                                                 | Status pills (APPROVED/PENDING/REJECTED) in admin UI                                             |
  | Doctor                 | `vobase channels:doctor :instanceId` + `<InstanceDoctorSheet>`                                         | Runs `debug_token`, `subscribed_apps`, `phone_numbers`, `message_templates`                      |
  | Coexistence echoes     | `parseWhatsAppEchoes` + `dispatchInbound` non-waking path                                              | `role='staff'`, `metadata.echoSource`, no wake, no window open, no `add_note` fan-out            |

  ## Embedded Signup (Cloud + Coexistence)

  Server-side OAuth-style signup that meets Meta's "embedded" requirement (code exchange happens on the backend within the 60s code TTL). Supports both:

  - **Cloud signup** — full Meta-hosted onboarding, tenant gets a fresh BISU access token, WABA, and phone number.
  - **Coexistence signup** — links an existing WhatsApp Business App number; inbound webhooks include `smb_message_echoes` for staff messages typed on the phone.

  Backend wiring:

  ```ts
  POST / api / channels / whatsapp / signup / start; // mints (orgId, sessionId)-bound nonce
  POST / api / channels / whatsapp / signup / exchange; // validates nonce + debug_token, exchanges code → token, creates instance
  ```

  Frontend launcher: `<WhatsAppSignupButton variant="hero" | "compact" />` (Facebook SDK loaded via `src/lib/facebook-sdk.ts`).

  Hardening:

  - `signup_nonces` table: atomic `DELETE … RETURNING` consume, 5-min expiry, bound to `(orgId, sessionId)` from better-auth session cookie.
  - `debug_token` validation **mandatory** before persistence — confirms `app_id` match and that the WABA appears in `granular_scopes[].target_ids`. Failure consumes the nonce (frontend re-`/start`).
  - Per-org rate limit: 10 successful exchanges/hour. Separate per-source-IP token bucket (60/min) for validation failures so a low-priv member can't lock out the org admin's success bucket.
  - Admin role gating via `getRequireAdmin()` lazy accessor on every signup/managed/doctor mutation route.

  ## Platform-managed sandbox channels (cross-repo)

  For tenants without a Meta Developer App, the platform allocates dedicated sandbox phone numbers from a pool. Tenant config carries only `{ mode: 'managed', platformChannelId, platformBaseUrl }` — zero Meta credentials at rest.

  New tenant ↔ platform contract (HMAC sig v2):

  ```
  payload  = `${METHOD}|${pathOnly}|${sortedCanonicalQuery}|${sha256(body)}`
  headers  = X-Vobase-Routine-Sig, X-Vobase-Rotation-Sig, X-Vobase-Key-Version,
             X-Vobase-Sig-Version: 2, X-Vobase-Body-Digest, X-Tenant-Id
  fallback = X-Platform-Signature (v1, body-unsigned — emitted in parallel during rollout)
  ```

  Platform accepts either by default; flip `MANAGED_REQUIRE_SIG_V2=true` after all tenants confirm v2 traffic. 5-minute rotation grace window verifies against current + previous secret.

  TOCTOU-safe `upsertManagedInstance` via Postgres generated column + partial unique index:

  ```sql
  platform_channel_id text GENERATED ALWAYS AS ((config->>'platformChannelId')) STORED
  INSERT … ON CONFLICT (platform_channel_id) WHERE platform_channel_id IS NOT NULL …
  ```

  ## Channels admin UI revamp

  Single unified `<ChannelsTable>` (DiceUI data-table) replaces the prior tile catalog. WhatsApp + Web channels coexist in one row list with a `<ModeChip>` (Self-managed / Platform sandbox / Web embed) per row. Row-action menu opens slide-over sheets for Doctor (WA), Templates (WA), and Embed snippets (Web) — no separate pages, no routing.

  Components added:

  - `<WhatsAppSignupButton variant="hero" | "compact">` — Facebook SDK launcher
  - `<WhatsAppEmptyState>` + `<ConnectWhatsAppSheet>` — first-run flow
  - `<TemplatesSheet>` + `<TemplatesTable>` — shared between sheet and dedicated `/channels/templates` page
  - `<InstanceDoctorSheet>` + `useInstanceDoctor()` hook — per-instance health probe
  - `<WebChannelDetailsSheet>` — embed snippets, bubble preview, install instructions
  - `<ChannelRowMenu>` — Doctor / Templates / Embed / Reassign default (placeholder, disabled)

  CLI verbs registered:

  - `vobase channels:list`
  - `vobase channels:instance:show :id`
  - `vobase channels:doctor :id`
  - `vobase channels:templates:sync :id`

  ## Core: envelope-encrypted secrets vault

  New `@vobase/core/hmac/encrypt` exports:

  ```ts
  encrypt(plaintext, { keyVersion: number }); // → { ciphertext, kekVersion, dekWrapped, iv, tag }
  decrypt({ ciphertext, kekVersion, dekWrapped, iv, tag }); // throws on tag mismatch
  ```

  - AES-256-GCM with envelope encryption (per-row DEK wrapped by versioned KEK).
  - KEK derivation: `HKDF-SHA256(BETTER_AUTH_SECRET, salt='vobase-vault-kek-v1', info='kek-v1')`.
  - `BETTER_AUTH_SECRET < 32 chars` is **refused at runtime** — production must set this explicitly.
  - KEK rotation re-wraps DEKs without rewriting ciphertext rows. `kekVersion` column tracks the wrapping key per row.
  - 2-key contract for tenant ↔ platform: `routineSecret` (5-min rotation grace) + `rotationKey` (only authenticates `/api/integrations/token/update`, monotonic `keyVersion` rejects replay).

  ## Core: sliding-window rate limiter

  New `@vobase/core/rate-limits` primitive backed by `core.rate_limits` table:

  ```ts
  const limiter = createRateLimiter(db);
  await limiter.consume({
    key: `wa:exchange:${orgId}`,
    limit: 10,
    windowSeconds: 3600,
  });
  // → { allowed: true, remaining: 9, resetsAt }
  ```

  Used by ESU per-org success limiter and per-source-IP failure bucket. Generic enough for any module — webhook abuse, integration calls, agent tool budgets.

  ## Core: 2-key HMAC sig v2

  `packages/core/src/hmac/index.ts` extended with sig v2 helpers:

  - `signRequestV2({ method, path, query, body, currentSecret, rotationKey, keyVersion })` → emits the full v2 header bundle
  - `verifyRequestV2({ req, currentSecret, previousSecret?, previousValidUntil?, rotationKey, currentKeyVersion })` → accepts current + previous within grace window; rejects `keyVersion <= currentKeyVersion`

  ## Frontend bundle isolation

  `check:bundle` script extended to also forbid `~/runtime` imports from `src/**`. Prevents backend code (auth handles, db client, jobs) from leaking into the browser bundle. New `tsconfig` path `~/wake/*` distinguishes harness-only modules.

  ## Drive integration follow-ups

  Carry-along from the parallel Drive plan that this work depends on:

  - Inbound WhatsApp media auto-ingests into `drive_files` via `MessageReceivedEvent.media[]`.
  - `WakeTrigger.caption_ready` fires once OCR extraction completes for an attached file.
  - Drive list page gains UI upload, per-row actions, PDF readability gate, OCR provider AI SDK v6 fix, openai SDK v3 bump.

  ## Repo-wide secret scanning

  - `scripts/check-secrets.ts` + `.gitleaks.toml` — pre-commit secret scan with allowlists for fixtures.
  - `bun run check:secrets` runs in CI alongside `check:shape`, `check:bundle`, `check:shadcn-overrides`, `check:no-auto-nav-tabs`.

  ## Bug fixes

  - `fix(template/channels)`: TOCTOU race in `upsertManagedInstance` resolved via generated column + partial unique index (B3).
  - `fix(template/channels)`: `TRUST_PROXY_HOPS` env var for source-IP determination — defaults to `0` (ignore XFF) for prod safety. Operators behind a sanitizing proxy must set `TRUST_PROXY_HOPS=N` explicitly (SH4).
  - `fix(template/channels,integrations)`: admin role gating on managed/finish/doctor/instance mutations via `createRequireRole(db, ['owner','admin'])` (SH3).
  - `fix(template/integrations)`: release sends 2-key headers + persists previous pair on first handshake (B4+B5).
  - `fix(template/channels)`: restored web embed snippets via `<WebChannelDetailsSheet>` (regression from unified channels table — embed/snippets/bubble-preview now live behind row-action menu, mirroring the WA Doctor/Templates pattern).
  - `fix(template/drive)`: unblock upload preview by bumping openai SDK to v3 and remounting the editor on extract.

  ## Test coverage

  - 23 new test files (e2e + integration + unit + smoke):
    - `tests/e2e/messaging-{inbound-attachments,attachment-failure,attachment-orphan,inbound-redelivery,loser-of-race-reap}.test.ts`
    - `tests/e2e/caption-ready-wake.test.ts`
    - `modules/channels/handlers/whatsapp-signup.test.ts` (450 lines, full ESU flow)
    - `modules/channels/adapters/whatsapp/{managed-transport,echoes}.test.ts`
    - `modules/channels/service/{instances,signup-nonces,dispatch-routing}.test.ts`
    - `modules/messaging/service/{sessions,reactions}.test.ts`
    - `runtime/request-ip.test.ts` (TRUST_PROXY_HOPS coverage)
    - `tests/smoke/smoke-wa-{doctor,echo,inbound,templates}-live.test.ts` (env-gated, run via `bun run smoke:wa`)
  - 616 passing, 5 skipped, 1 todo. The 6 failures pre-existed on `main` (contacts service not installed in the channels echo test env) — not regressions from this work.

  ## Operational notes

  - **Recommended deploy order:** (1) Push vobase-platform branch + run migration (webhook router has legacy fallback). (2) Push tenant `main` (sends both v1 + v2 sig headers). (3) Monitor sig-v1 vs v2 traffic. (4) Once v1 traffic is zero, set `MANAGED_REQUIRE_SIG_V2=true` on platform.
  - **Backfill:** ops needs to populate `tenant_environments` rows for existing managed tenants so the per-env webhook resolver targets the right `instanceUrl`. Falls back gracefully today.
  - **Open follow-ups (non-blocking):** `Reassign default…` row action wired but disabled (needs AssigneeSelect popover); `mergeContacts(...)` is a JSDoc-only skeleton; vault `previous` decryption is eager per read (bounded by 60s rotation cache TTL — optional lazy follow-up).

  ## Dependencies

  No new runtime dependencies. The core stays free of crypto/rate-limiter packages — uses Bun's built-in `crypto.subtle` for AES-GCM and Drizzle for the rate-limits table. Facebook SDK loads at runtime in the frontend via `src/lib/facebook-sdk.ts` (no npm install).

## 0.35.0

### Minor Changes

- Canonical module shape + registry-driven workspace CLI. Reshapes the agent-facing surface so template modules declare contributions in one slot, and collapses the CLI dispatcher into a single registry consumed by both the bash sandbox and the HTTP-RPC binary.

  ## `ModuleDef.agent` slot

  - `agentsMd` (`IndexContributor[]` — AGENTS.md fragments), `materializers` (`WorkspaceMaterializerFactory<TCtx>[]`), `roHints` (`RoHintFn[]`), `tools` (`AgentTool[]`). All optional, all pure declarations.
  - `RoHintFn` lives in `module-def.ts` (its natural home) and is re-exported from `collect.ts` for API stability.
  - `WorkspaceMaterializerFactory<TCtx>(ctx) => WorkspaceMaterializer[]` — the collector aggregates per-module factories; wake builders call each with a template-specific `WakeContext`. Core stays generic over `TCtx` so template-domain types never leak.

  ## `AgentTool` metadata

  - `audience: 'customer' | 'internal'` — wake builders strip customer-facing tools on supervisor coaching wakes generically (no hardcoded names).
  - `lane: 'conversation' | 'standalone' | 'both'` — partitions the catalogue between conversation-bound and operator-thread/heartbeat wakes.
  - `prompt?: string` — colocated AGENTS.md guidance rendered under `## Tool guidance` next to the tool name.
  - `defineAgentTool({ ... })` ships from core (was a per-template helper).

  ## AGENTS.md generator + RO hints

  - `generateAgentsMd` accepts `extraContributors` (priority-sorted) so wake callers inject lane-scoped tool guidance + ad-hoc fragments.
  - `chainRoHints(hints)` composes per-module RO error overrides into a single `RoMessageOverride` (first non-null wins).

  ## Workspace CLI registry

  - `CliVerbRegistry` + `defineCliVerb` are the unified verb surface. The same body runs in-process for the agent's bash sandbox and over HTTP-RPC for the standalone CLI binary.
  - `createBashVobaseCommand` renders argv parser, help text, and result formatter from the registry — no per-tenant code. `parseBashArgv`, `coerceBashArgs`, `renderBashHelp`, `renderBashResult` exposed for custom transports.
  - `createInProcessTransport`, `createCatalogRoute`, `createCliDispatchRoute`, `defaultRouteForVerb` round out the transport set.
  - Verbs declare `audience: 'agent' | 'staff' | 'all'` so the bash sandbox can hide staff-only verbs.

  ## Removed

  - `CommandDef`, `CommandContext`, `findCommand`, `resolveCommandSet`, `createVobaseCommand`, `DEFAULT_READ_ONLY_VERBS`, `VobaseDispatcherOpts`, `AgentRole`. Use `CliVerbRegistry` + `defineCliVerb` instead.
  - `commands?` parameter on `CreateHarnessOpts` (verbs come from the registry now).

  ## Compatibility

  - `Bun.SQL` and `drizzle-orm/bun-sql` are resolved lazily at `createDatabase` call time. `drizzle-kit` walks the schema graph under Node and pulls `@vobase/core` transitively; top-level `import 'bun'` and `import 'drizzle-orm/bun-sql'` (which itself requires the `'bun'` builtin) used to crash that load. The postgres branch keeps working under Bun.
  - `Bun.S3Client` resolved the same way for `createS3Adapter`.

## 0.34.0

### Minor Changes

- Fold the agent harness, workspace, and module system into `@vobase/core` so apps stop owning their own copies. Consolidates nine changesets shipped in lockstep.

  ## Module system in core

  - `defineModule`, `bootModules` (alias `bootModulesCollector`), `sortModules`, `InvalidModuleError`. `ModuleDef<Db, Realtime, TCtx>` carries grouped optional surfaces — `web` (routes), `agent` (`agentsMd`, `materializers`, `roHints`, `tools`), `jobs`. Three collectors flatten the bag: `collectAgentContributions`, `collectWebRoutes`, `collectJobs`.
  - The v1 module/app runtime is **removed**: `createApp`, `CreateAppConfig`, `VobaseCtx`, `getCtx`, `contextMiddleware`, `registerModules`, `ModuleInitContext`, `createThrowProxy`. Built-in module factories (`createAuditModule`, `createAuthModule`, `createChannelsModule`, `createIntegrationsModule`, `createSequencesModule`, `createStorageModule`) and their middleware/permission helpers (`requireRole`, `requirePermission`, `requireOrg`, `requestAuditMiddleware`, audit hooks, `getActiveSchemas`) are gone. MCP CRUD generation deleted. Schema tables (`auditLog`, `recordAudits`, `sequences`, `storageObjects`, `channelsLog`, `channelsTemplates`, `integrationsTable`, `auth*`, `webhookDedup`) still ship from the root barrel.
  - File reorg: `src/infra/*` → flat `src/{errors,logger,realtime,jobs,http,hmac}/`. `src/modules/*/schema.ts` → `src/schemas/*.ts`. Storage and channel adapters → `src/adapters/{storage,channels}/`.

  ## Harness primitives

  - `createHarness({ agentDefinition, workspace, systemPrompt, systemHash, trigger, renderTrigger, model, getApiKey, tools, hooks, materializers, sideLoadContributors, runtime, ... })` wraps `pi-agent-core` with multi-listener `HarnessHooks` (`on_tool_call`, `on_tool_result`, `on_event`) and an optional `emitEventHandle` for synthesized events.
  - `makeBashTool` (single typed `bash` `AgentTool` with three-layer 4KB / 100KB / 200KB byte budget), `TurnBudget`, `L1_PREVIEW_BYTES`, `L2_SPILL_BYTES`, `L3_CEILING_BYTES`, `spillToFile`, `collectSideLoad`, `createBashHistoryMaterializer`, `createRestartRecoveryContributor`, `classifyError`, `createSteerQueue`, `newWakeId`.
  - `WakeRuntime = { fs: IFileSystem; tracker: DirtyTracker }` is required by `CreateHarnessOpts`. `OnEventListener<T>` / `OnToolCallListener` / `OnToolResultListener` gain a second arg `(event, runtime)` (function-arity subtyping keeps existing one-arg listeners assignable).
  - `llmCall`, `LlmCallArgs`, `LlmEmitter`, `LlmRequest`, `LlmResult` ship from core; `model: Model<any>` + `apiKey?: string` decouple from env-var resolution.
  - `withJournaledTx(db, journal, fn)` enforces journal append inside every domain transaction; `JournaledTxDb` is a minimal Drizzle-free shape.

  ## Workspace + virtual filesystem

  - `ScopedFs`, `checkWriteAllowed`, `isWritablePath(path, writablePrefixes)`, `buildReadOnlyConfig({ writablePrefixes, readOnlyExact?, memoryPaths?, readOnlyPrefixes? })`, `ReadOnlyFsError`, `DirtyTracker(snapshot, writablePrefixes)`, `snapshotFs`, `MaterializerRegistry` (frozen / side-load / on-read phases). Apps must declare their writable zones — core no longer ships a helpdesk-specific default. `WRITABLE_PREFIXES` is gone.
  - `createWorkspace` is domain-free; templates wrap it with their own lazy mounts.
  - `generateAgentsMd({ agentName, agentId, commands, instructions })` emits a unified `/agents/<id>/AGENTS.md` (title line, framework preamble, CLI reference, verbatim instructions block). Replaces split SOUL.md / TOOLS.md / bookings.md files.
  - `ScopedDiff.staffMemory: Map<staffId, DirtyDiff>` keys staff-memory writes for the workspace-sync observer.

  ## Path space

  - Drop the `/workspace/` prefix everywhere. Unified namespace keyed by nanoid: `/agents/<agentId>/`, `/contacts/<contactId>/`, `/contacts/<contactId>/<channelInstanceId>/`, `/drive/`, `/tmp/`, `/staff/<staffId>/`. Conversation files (`messages.md`, `internal-notes.md`) live under `/contacts/<contactId>/<channelInstanceId>/`; the `conversations` table + `conversationId` column survive only as DB keys.
  - Bash cwd starts at `/agents/<agentId>/`. `agent_definitions.soul_md` → `instructions`; `/SOUL.md` → embedded in AGENTS.md.
  - Active-IDs preamble opens the frozen prompt: conversational wakes emit `"You are /agents/<agentId>/, conversing with /contacts/<contactId>/ via /contacts/<contactId>/<channelInstanceId>/. Latest at .../messages.md."`; non-conversational wakes emit `"You are /agents/<agentId>/."`.
  - `buildFrozenEagerPaths({ agentId, contactId, channelInstanceId })`, `CreateWorkspaceOpts.channelInstanceId` (required), `FrozenPromptInput.channelInstanceId` (replaces `conversationId`).
  - `RUNTIME_OWNED_PATHS` drops `/conversations/`, adds `/staff/`. `buildDefaultReadOnlyConfig` takes `{ agentId, contactId, channelInstanceId, staffIds? }`; adds RO-exact entries for `/contacts/<id>/<channelInstanceId>/{messages,internal-notes}.md` and `/staff/<id>/profile.md`, plus memory-hint paths for `/staff/<id>/MEMORY.md`. Contact `profile.md` first line is `# <displayName-or-fallback> (<contactId>)`.

  ## Persistence (`harness` pgSchema)

  Six tables now ship from core: `conversation_events`, `active_wakes`, `threads`, `messages` (agent-thread payloads), `tenant_cost_daily`, `audit_wake_map`. Matching services — `journal` (sole writer of `conversation_events`), `cost` (sole writer of `tenant_cost_daily`), `message-history` (thread + pi `AgentMessage` load/save), `wake-registry` (renamed from `active-wakes`) — are imported from `@vobase/core`. Templates keep their domain tables (`agent_definitions`, `learned_skills`, `learning_proposals`, `agent_scores`); cross-schema FKs (`harness.threads.agent_id → agents.agent_definitions`, `agents.learning_proposals.wake_event_id → harness.conversation_events`) are enforced via `db-apply-extras`.

  ## Removed observer/mutator infra

  `ObserverContext`, the `ctx.events` EventBus, `registerObserverFactory`, `registerMutator`, `ScopedScheduler`, `ScopedStorage` are all gone. Listeners are plain `OnEventListener` functions closing over service singletons; modules consume raw adapters; queue/bucket naming is convention, not a runtime invariant.

  ## Peer dependency

  `just-bash ^2.14.2` — bash tool + RO enforcer build on its `IFileSystem` contract.

## 0.33.0

### Minor Changes

- [`d792910`](https://github.com/vobase/vobase/commit/d7929108fc7c54e7e5ac66a7d7300886fa028b35) Thanks [@mdluo](https://github.com/mdluo)! - # Realtime LISTEN DSN + auth id generation + idempotent auto-join

  Three focused core changes shipped together.

  ## Realtime: dedicated LISTEN DSN for pooled deployments

  The realtime service (`createRealtimeService` / `createApp`) now accepts an
  optional dedicated DSN for its LISTEN connection. This fixes silent SSE
  blackouts on Neon and any PgBouncer-fronted deploy where the app pool runs
  in transaction mode.

  ## Why

  PgBouncer in transaction mode multiplexes statements across backend sessions
  — `pg_notify` on one session and `LISTEN` on another never meet, so realtime
  events silently vanish. On Neon specifically, the default `DATABASE_URL`
  points at the `-pooler` endpoint, which triggered exactly this: `notify`
  fires, `dispatch` never does, and the inbox stops live-updating.

  The fix is to route just the single persistent LISTEN connection at a
  non-pooler DSN while app queries keep hitting the pool for connection
  headroom.

  ## API

  `createRealtimeService` takes a third options argument:

  ```ts
  import { createRealtimeService } from "@vobase/core";

  const realtime = await createRealtimeService(
    process.env.DATABASE_URL!, // pooled — used for app queries
    db,
    { listenDsn: process.env.DATABASE_URL_DIRECT } // direct — used for LISTEN
  );
  ```

  `CreateAppConfig` gains a matching `databaseDirect` field, so apps wired
  through `createApp` only need a config tweak:

  ```ts
  const config: CreateAppConfig = {
    database: process.env.DATABASE_URL!,
    databaseDirect: process.env.DATABASE_URL_DIRECT, // optional
    modules: [...],
  };
  ```

  Both options default to reusing the main DSN when unset — self-hosted
  Postgres and PGlite deployments need no changes.

  ## Migration

  - **Self-hosted Postgres / local dev**: no action required.
  - **Neon**: add a `DATABASE_URL_DIRECT` env var pointing at the direct
    endpoint (strip `-pooler` from the pooled host), then set
    `databaseDirect: process.env.DATABASE_URL_DIRECT` in `vobase.config.ts`.
    The template's `.env.example` documents the exact format.
  - **Other PgBouncer setups**: same pattern — point `DATABASE_URL_DIRECT`
    at a connection path that preserves session state.

  ## Auth: Better-Auth id generation aligned with domain tables

  `createAuthModule` now sets `advanced.database.generateId` to the same
  `createNanoid()` generator used by `nanoidPrimaryKey()`, so Better-Auth-minted
  ids (`user`, `session`, `account`, `member`, `invitation`, `team`, `verification`,
  `apikey`) use the same 8-char lowercase-alphanumeric alphabet as every domain
  table. No DB extension dependency, no schema change — new rows only. The CLI
  config at `packages/core/auth.ts` applies the same override so regenerated
  schemas match runtime behavior.

  ## Auth: idempotent auto-join

  `autoJoinUser` now uses `onConflictDoNothing` on `(userId, organizationId)`
  for both the pending-invitation and sole-org domain-match insert paths. The
  `member` table carries a `uniqueIndex('member_user_org_unique_idx')`, so the
  previous plain insert raised a unique-violation whenever auto-join fired twice
  for the same signup (e.g. once from `user.create.after` and again from
  `session.create.before` in downstream configs). The guard silences the noise
  without changing semantics — one membership per (user, org) is already the
  invariant.

## 0.32.1

### Patch Changes

- [`ad4bf1e`](https://github.com/vobase/vobase/commit/ad4bf1ed0851ed5cd17d48f8d32fd2cf8e034c4d) Thanks [@mdluo](https://github.com/mdluo)! - # Shorten default nanoid IDs from 12 to 8 characters

  Reduced the default nanoid primary key length from 12 to 8 characters across all tables. Each Vobase project is single-tenant with relatively small data volumes, so 12 characters of entropy was unnecessarily long. 8 characters with a 36-char alphabet provides ~41 bits of entropy (~2.8 trillion possible IDs) — more than sufficient.

  ## Changes

  - `NANOID_LENGTH.DEFAULT`: 12 → 8
  - `NANOID_LENGTH.SHORT`: 8 → 6
  - `NANOID_LENGTH.LONG`: 16 → 12
  - Updated all hardcoded `nanoid(12)` SQL in test fixtures to `nanoid(8)`

  ## Migration Note

  Existing databases need a `bun run db:push` (dev) or new migration (prod) to pick up the new column defaults. Existing rows with 12-char IDs remain valid — only newly inserted rows will use 8-char IDs.

- [`3ead6c7`](https://github.com/vobase/vobase/commit/3ead6c70950ff742ca4f52a207551c7c187c1950) Thanks [@mdluo](https://github.com/mdluo)! - # WhatsApp Adapter Decomposition

  Decomposed the monolithic `adapters/whatsapp.ts` (1287 lines, 6 concerns) into a focused `adapters/whatsapp/` directory with single-responsibility modules.

  ## What Changed

  The single `whatsapp.ts` file has been split into 6 modules using a factory composition pattern:

  | Module          | Lines | Responsibility                                                                                                  |
  | --------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
  | `types.ts`      | ~94   | Types, error class, constants (zero dependencies)                                                               |
  | `api.ts`        | ~345  | `createApiClient()` factory: `transportFetch`, `graphFetch`, `downloadMedia` closures + stateless helpers       |
  | `templates.ts`  | ~114  | `createTemplateOperations()` factory: sync, create, delete, get templates                                       |
  | `management.ts` | ~192  | `createManagementOperations()` factory: health check, webhook subscription, token status, messaging tier        |
  | `adapter.ts`    | ~546  | Main `createWhatsAppAdapter()` factory composing all siblings + dedup state, webhook verification, send methods |
  | `index.ts`      | ~5    | Barrel re-exports                                                                                               |

  `shared.ts` and test files moved into the directory with updated import paths.

  ## Architecture

  The decomposition uses **closure-based dependency injection** — each factory receives `graphFetch` and `config` as explicit parameters rather than relying on a monolithic closure scope. The adapter factory composes them:

  ```typescript
  const { graphFetch, downloadMedia } = createApiClient(config, httpClient);
  const templateOps = createTemplateOperations(graphFetch, phoneNumberId);
  const managementOps = createManagementOperations(config, graphFetch);
  ```

  ## Zero Breaking Changes

  - All public exports from `@vobase/core` are unchanged
  - The barrel `index.ts` provides transparent re-exports
  - Test-only exports (`_chunkText`, `_ERROR_CODE_MAP`) preserved
  - Resend and SMTP adapters annotated with JSDoc as outbound-only transports

## 0.32.0

### Minor Changes

- [`e31a02d`](https://github.com/vobase/vobase/commit/e31a02dc0cf7aee5ca83936c4ac18cd072197daf) Thanks [@mdluo](https://github.com/mdluo)! - # Decouple Core from Platform

  Remove all platform-specific code from `@vobase/core`, making it a fully generic framework. Platform-specific functionality (auth plugins, push routes, token refresh) now belongs in the template layer.

  ## Breaking Changes

  ### Removed Exports

  | Removed Export                             | Replacement                                                                       |
  | ------------------------------------------ | --------------------------------------------------------------------------------- |
  | `signPlatformRequest(payload, secret)`     | `signHmac(payload, secret)` — identical signature, drop-in rename                 |
  | `verifyPlatformSignature(body, sig)`       | `verifyHmacSignature(body, sig, secret)` — now requires explicit secret parameter |
  | `isPlatformEnabled()`                      | Check `process.env.PLATFORM_HMAC_SECRET` directly                                 |
  | `createPlatformIntegrationsRoutes(config)` | Removed — relocate to template if needed                                          |
  | `PlatformRoutesConfig`                     | Removed                                                                           |
  | `platformAuth(config)`                     | Relocate to template, register via `extraPlugins` in auth config                  |
  | `PlatformAuthConfig`                       | Relocate to template                                                              |
  | `refreshViaPlat(provider, url, secret)`    | Use `setPlatformRefresh(fn)` to register a callback                               |

  ### Migration Guide

  **HMAC signing:**

  ```ts
  // Before
  import { signPlatformRequest } from "@vobase/core";
  const sig = signPlatformRequest(payload, secret);

  // After
  import { signHmac } from "@vobase/core";
  const sig = signHmac(payload, secret);
  ```

  **Token refresh delegation:**

  ```ts
  // Before: core called refreshViaPlat() internally when PLATFORM_HMAC_SECRET was set

  // After: register a callback in your module init hook
  import { setPlatformRefresh } from "@vobase/core";

  setPlatformRefresh(async (provider) => {
    // Your refresh logic — call platform, return { accessToken, expiresInSeconds? }
  });
  ```

  **Auth plugin:**

  ```ts
  // Before: platformAuth was auto-registered when PLATFORM_HMAC_SECRET was set

  // After: register via extraPlugins in auth config
  createApp({
    auth: {
      extraPlugins: [
        myPlatformAuthPlugin({ hmacSecret: process.env.PLATFORM_HMAC_SECRET }),
      ],
    },
  });
  ```

  ## New Exports

  | Export                      | Description                                                                              |
  | --------------------------- | ---------------------------------------------------------------------------------------- |
  | `signHmac(payload, secret)` | HMAC-SHA256 signing (replaces `signPlatformRequest`)                                     |
  | `setPlatformRefresh(fn)`    | Register a token refresh callback for platform-managed integrations                      |
  | `getPlatformRefresh()`      | Retrieve the registered refresh callback                                                 |
  | `PlatformRefreshFn`         | Type: `(provider: string) => Promise<RefreshResult>`                                     |
  | `ProvisionChannelData`      | Re-exported from `channels/service` (was in `platform.ts`, `source` widened to `string`) |

  ## Internal Changes

  - `getRefreshMode()` now checks for a registered callback instead of env vars. Logs a warning when `PLATFORM_HMAC_SECRET` + `PLATFORM_URL` are set but no callback is registered.
  - Webhook handler uses `verifyHmacSignature` with explicit secret parameter instead of `verifyPlatformSignature` which read the secret from env internally.
  - `ProvisionChannelData.source` widened from `'platform' | 'sandbox'` to `string` for generic use.

  ## Bug Fix

  - Fixed `PLATFORM_TENANT_SLUG` not being set during tenant provisioning (both production and staging flows), which caused token refresh to fail for all provisioned tenants.

### Patch Changes

- [`dcca015`](https://github.com/vobase/vobase/commit/dcca015a3b860b93875c617e8223247c1f91740e) Thanks [@mdluo](https://github.com/mdluo)! - Add connection pool tuning for cloud-hosted PostgreSQL (Neon). Configure idle timeout, max lifetime, and connection timeout on bun:sql; explicit pool size on pg-boss; increased connect timeout on realtime LISTEN connection.

## 0.31.0

### Minor Changes

- [`70e1fcb`](https://github.com/vobase/vobase/commit/70e1fcb0a5fd10bec0b3aa7ef4dc2b7a3026f835) Thanks [@mdluo](https://github.com/mdluo)! - # Channel Adapter Contract Extensions & Organization Teams

  ## Channel Adapter Contract

  Extended `ChannelAdapter` with six new optional fields for richer channel integration:

  | Field                    | Type                                 | Purpose                                                                        |
  | ------------------------ | ------------------------------------ | ------------------------------------------------------------------------------ |
  | `serializeOutbound`      | `(message) => OutboundMessage`       | Adapter-specific outbound serialization (template, interactive, media routing) |
  | `renderContent`          | `(text) => string`                   | Format text for channel (e.g. WhatsApp markdown, email HTML wrapping)          |
  | `deliveryModel`          | `'queued' \| 'realtime'`             | Whether messages go through delivery queue or are instant (web)                |
  | `contactIdentifierField` | `'phone' \| 'email' \| 'identifier'` | Which contact field to use for outbound addressing                             |
  | `debounceWindowMs`       | `number`                             | Per-channel debounce window in ms (WhatsApp: 3000, Email: 30000, Web: 0)       |
  | `getSessionContext`      | `(session) => string \| null`        | Format session state for agent prompt injection                                |

  All fields are optional — existing adapters continue to work without changes.

  ## Channels Service API

  Added two new lookup methods to `ChannelsService`:

  - **`get(type: string)`** — look up a `ChannelSend` by type name with internal caching. Returns `undefined` if not registered.
  - **`getAdapter(type: string)`** — look up the raw `ChannelAdapter` by type name. Returns `undefined` if not registered.

  These complement the existing `email` and `whatsapp` convenience properties for dynamic channel access.

  ## Organization Teams

  Added better-auth teams support within organizations:

  - New `AuthModuleConfig.teams` option (default: `true`) enables teams within organizations
  - New tables: `authTeam` (id, name, organizationId) and `authTeamMember` (id, teamId, userId)
  - New session field: `activeTeamId` on `authSession`
  - New invitation field: `teamId` on `authInvitation`
  - New exports: `authTeam`, `authTeamMember` from `@vobase/core`

  ## Platform Auth

  Default organization creation now uses `VITE_PLATFORM_TENANT_SLUG` env var for the org slug instead of deriving it from the tenant name. Both `VITE_PLATFORM_TENANT_NAME` and `VITE_PLATFORM_TENANT_SLUG` are now required for auto-org creation.

  ## Test Infrastructure

  Updated PGlite test DDL to include `active_team_id` column in session table, matching the schema changes.

- [`b7ca9fc`](https://github.com/vobase/vobase/commit/b7ca9fcd7a20ec162baf4befcb240b6dce948761) Thanks [@mdluo](https://github.com/mdluo)! - Add transport abstraction to WhatsApp adapter for managed channels

  - `WhatsAppTransportConfig` interface: route all Graph API calls through a proxy instead of calling Meta directly
  - `transportFetch` closure: centralized URL construction, HMAC signing (method+path), proxy error interception
  - Media download proxy: dedicated endpoint for binary CDN downloads with Bearer auth
  - Instance-ID keyed adapter resolution: `channels.getAdapter(instanceId) ?? channels.getAdapter(type)`
  - `unregisterAdapter()` on ChannelsService for managed channel disconnect
  - `signPlatformRequest()` export for tenant→platform HMAC signing
  - Extracted shared webhook parsing to `whatsapp-shared.ts`
  - Full feature parity with direct channels (media, reactions, read receipts, template sync)

## 0.30.3

### Patch Changes

- Gate auto-create org on VITE_PLATFORM_TENANT_NAME env var

  Only auto-create the default organization when `VITE_PLATFORM_TENANT_NAME` is set, preventing the platform service and test environments from creating unwanted orgs.

## 0.30.2

### Patch Changes

- Fix auth module init hook not being called on boot

  The auth module's init hook (auto-creates default organization) was never invoked because `createApp` only called init on audit and sequences modules. Now correctly calls `authMod.init?.(initCtx)`.

## 0.30.1

### Patch Changes

- Use VITE_PLATFORM_TENANT_NAME for default org name

  The auto-created default organization now reads its name from the `VITE_PLATFORM_TENANT_NAME` environment variable, falling back to `appName` config. This ensures platform-provisioned tenants get an org named after the tenant, not the product.

## 0.30.0

### Minor Changes

- Auto-create default organization on first boot

  When the auth module initializes and no organization exists in the database, automatically create a default one using the `appName` config value. This ensures platform-provisioned projects have a working org without needing to run the seed script. Combined with the first-member-owner feature (first domain-matched user becomes org owner), new deployments are fully functional out of the box.

## 0.29.1

### Patch Changes

- First domain-matched member auto-joins as org owner

  When a user auto-joins an organization via email domain match, the first member to join becomes the `owner` instead of `member`. Subsequent domain-matched users continue to join as `member`. This ensures newly provisioned orgs with domain auto-join have an owner without manual role assignment.

## 0.29.0

### Minor Changes

- [`a4749b4`](https://github.com/vobase/vobase/commit/a4749b40142a0d65f1c4b981c1c93f2e0566a76f) Thanks [@mdluo](https://github.com/mdluo)! - Add organization auto-join on sign-in and multi-org support

  - Configure better-auth organization plugin with `multiOrg` flag (default `false` for single-org soft-lock) and `sendInvitationEmail` callback
  - Auto-join organization after sign-in: pending invitation acceptance (any mode) or domain-based join (single-org only)
  - Auto-set `activeOrganizationId` on session so `requireOrg()` works immediately
  - Export `SendInvitationEmail` type from core

## 0.28.0

### Minor Changes

- Email OTP auth, domain allowlist, and channel provisioning IoC

  - Migrate auth from email+password to email OTP as the sole sign-in method
  - Add `allowedEmailDomains` config to restrict self-signup to specific domains (existing users bypass the check)
  - Add `extraPlugins` config for template-level better-auth plugins (e.g. dev-login)
  - Add `appName` config for white-label branding in auth emails
  - Enforce domain allowlist on platform OAuth callback
  - Move channel provisioning from config callback (`onProvisionChannel`) to `ChannelsService.onProvision()` for module ownership
  - Remove `ProvisionChannelCtx` export (replaced by `ProvisionChannelData`)
  - Remove `EmailOTPOptions` export (replaced by `SendVerificationOTP`)

## 0.27.4

### Patch Changes

- Add detailed logging to inbound webhook handler: log on receipt, signature verification, event parsing, and event emission for debugging webhook delivery issues.

## 0.27.3

### Patch Changes

- Add integrations service to ProvisionChannelCtx, enabling onProvisionChannel callbacks to read stored credentials from the vault for hot-registering channel adapters during platform provisioning.

## 0.27.2

### Patch Changes

- [`e41d659`](https://github.com/vobase/vobase/commit/e41d6597afe631060f6b0978276e71e324b44e5b) Thanks [@mdluo](https://github.com/mdluo)! - Graceful fallback for job worker when pg-boss fails to start. Returns a no-op worker so the app boots without job processing instead of crashing.

## 0.27.1

### Patch Changes

- [`93ff614`](https://github.com/vobase/vobase/commit/93ff6147a73791dd4e40939912bbb3ee0851a749) Thanks [@mdluo](https://github.com/mdluo)! - Graceful fallback when pg-boss fails to start (e.g. stale schema). Returns a no-op scheduler that logs warnings instead of crashing the app. Also catches errors inside `schedule()` to prevent unhandled rejections from synchronous `init()` hooks.

## 0.27.0

### Minor Changes

- [`41ca4d8`](https://github.com/vobase/vobase/commit/41ca4d844d399cfc3fedb92754d3a43950b33dd2) Thanks [@mdluo](https://github.com/mdluo)! - Add `scheduler.schedule()` / `unschedule()` API backed by pg-boss cron for persistent, idempotent, multi-instance-safe recurring jobs. Migrate integrations token refresh from `setInterval` to `schedule()`.

  Harden integrations service: add `'disconnected'` to schema CHECK constraint, Zod-validate `/token/update` platform endpoint, extend `updateConfig` with `label`/`scopes` opts, throw on decrypt failure instead of returning `{}`, narrow `getActive` catch to table-missing errors only, merge `markRefreshed` into `updateConfig` to eliminate double-write, and validate `PLATFORM_TENANT_SLUG` before platform refresh fetch.

## 0.26.0

### Minor Changes

- [`839158a`](https://github.com/vobase/vobase/commit/839158ac8801e8617d6a739663a21f4c1f0fe7a4) Thanks [@mdluo](https://github.com/mdluo)! - feat(core): Cloudflare integration — configure upsert, storage vault override, getActive ordering

  **Configure endpoint upsert:**

  - Configure handler checks for existing active platform-managed integration before inserting
  - Prevents duplicate rows on re-provisioning or credential rotation
  - `updateConfig()` gains `markRefreshed` option to combine two DB calls into one
  - `updateConfig()` preserves existing `configExpiresAt` when `expiresAt` not provided

  **Storage vault override:**

  - New optional `storage.integrationProvider` field on `CreateAppConfig`
  - When set and static config is local, checks integrations vault at boot for S3-compatible credentials
  - Generic: template chooses provider name (e.g. `'cloudflare-r2'`), core does vault resolution
  - Bucket definitions always come from static config; vault only provides connection fields
  - No-op when vault is empty (falls back to static config)

  **Integrations service:**

  - `getActive()` now orders by `updatedAt` desc for deterministic results
  - Added unique partial index: one active platform integration per provider (DB-level guard)

- [`2abb69d`](https://github.com/vobase/vobase/commit/2abb69dcadc5ec7853de4e7e339e16ce5c420cf1) Thanks [@mdluo](https://github.com/mdluo)! - feat(core): platform-core alignment — provision-channel route, X-Tenant-Slug, HMAC helper

  **Platform integration routes:**

  - Added `onProvisionChannel` callback to `PlatformRoutesConfig` and `CreateAppConfig`
  - New `POST /api/integrations/provision-channel` route — conditionally registered, HMAC-verified, Zod-validated, sanitized 502 on callback errors
  - Exported `ProvisionChannelData`, `ProvisionChannelCtx`, and `PlatformRoutesConfig` types
  - Extracted `verifyPlatformRequest()` helper to deduplicate HMAC guard across all 3 routes
  - Updated frozen contract documentation

  **Platform token refresh:**

  - `refreshViaPlat` now sends `X-Tenant-Slug` header (from `PLATFORM_TENANT_SLUG` env var)
  - Throws descriptive error if env var is missing instead of sending empty string

## 0.24.0

### Minor Changes

- [`2c87528`](https://github.com/vobase/vobase/commit/2c87528e9b09afe5f1b80cc8a7fa6677bb6e66cd) Thanks [@mdluo](https://github.com/mdluo)! - Add createApiKey/revokeApiKey to auth contract and ModuleInitContext

  - New `CreateApiKey` and `RevokeApiKey` types in auth contract for programmatic API key management
  - `revokeApiKey(keyId)` disables an API key by ID (used by automation module on session disconnect)
  - `createApiKey` accepts `expiresIn` for time-bounded keys
  - Organization tables now always included in schema (no longer conditional)
  - Removed `organizationEnabled` from MCP CRUD context and permission guards
  - API key schema updated: `referenceId`/`configId` columns replace `userId`, proper rate limit defaults
  - Added `activeOrganizationId` to session table

## 0.23.1

### Patch Changes

- [`bd61237`](https://github.com/vobase/vobase/commit/bd61237eae81c36b05ea3f0642e0b858db250bac) Thanks [@mdluo](https://github.com/mdluo)! - # HTTP Client Retry Fix & Codebase Cleanup

  ## HTTP Client: Body Replay on Retry

  Fixed a bug where `createHttpClient` would throw "Body already used" when retrying a POST/PUT/PATCH request after a transient failure. `ReadableStream` bodies are now buffered to `ArrayBuffer` before the retry loop so they can be replayed safely.

  Added `retryAllMethods` option (default `false`) to opt in to 5xx retries for non-GET methods. GET requests continue to retry by default. This prevents accidental duplicate side effects on non-idempotent endpoints while allowing callers like the WhatsApp adapter to explicitly enable retries.

  ```ts
  const http = createHttpClient({
    retries: 3,
    retryAllMethods: true, // opt in to POST/PUT/DELETE retries on 5xx
  });
  ```

  ## Template: Raw Fetch Replaced with Hono RPC Client

  Replaced 10 plain `fetch()` calls across 5 template files with typed `aiClient` RPC calls from `@/lib/api-client`. Feedback mutations now use `useMutation` from TanStack Query. Fire-and-forget calls (read tracking, typing indicators) use the RPC client directly.

  **Files migrated:** `use-feedback.ts`, `use-public-chat.ts`, `use-typing-indicator.ts`, `use-read-tracking.ts`, `chat.$channelRoutingId.tsx`

  ## Lint Warnings Resolved

  Fixed all 21 pre-existing lint warnings across core and template:

  - Non-null assertions replaced with optional chaining in test files
  - Removed unused `afterEach` import from storage tests
  - Added biome-ignore for legitimate edge cases (guaranteed non-null after create, KB batch submit)

  ## Dead Code Removal

  Deleted 22 unused files (hooks, components, utilities, constants) and removed 18 unused dependencies from `package.json` files. Cleaned up stale knip ignore patterns and orphaned test cases.

  ## Test Coverage

  All 31 HTTP client tests pass, including new test for POST retry with body replay verification.

## 0.23.0

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

## 0.22.1

### Patch Changes

- [`5dbe914`](https://github.com/vobase/vobase/commit/5dbe914be2f738afac84f8c248ce090be5a51851) Thanks [@mdluo](https://github.com/mdluo)! - # AI-Native Messaging: Multi-Channel Agent + Conversations Workspace

  ![Multi-Channel Agent](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-multi-channel-agent-v0.12.0.png)

  ## Overview

  Complete overhaul of the messaging architecture — from ticket-based agents to an AI-native conversations workspace. The template now ships a booking agent with multi-channel support, a consolidated conversations module, production-grade reliability, and rich data tables with server-side filtering.

  ***

  ## AI-Native Inbox Redesign

  Replaced the old ticket-based messaging module with a purpose-built conversations system:

  - **Booking agent** with tools: check-availability, book-slot, cancel-booking, reschedule, send-reminder, consult-human
  - **Session lifecycle workflow** for managing booking conversations end-to-end
  - **Contacts module** for customer/staff directory (later consolidated into conversations)
  - **Dashboard module** for agent control plane and session monitoring (later consolidated into conversations)
  - Removed old assistant/quick-helper agents, ticket management tools, and escalation workflows

  ## Consolidated Conversations Workspace

  All messaging functionality absorbed into a single `conversations` module:

  - **Contacts** merged into conversations (shared `conversationsPgSchema`, AD-3 pattern)
  - **Dashboard pages** moved to `conversations/pages/sessions`
  - **AI pages** (agents, evals, guardrails, memory) moved under `conversations/pages/ai`
  - **Channels page** added for endpoint/channel instance management
  - Navigation restructured: Conversations > Sessions, Contacts, Channels, AI
  - Chat endpoint renamed from `inboxId` to `endpointId`

  ## Multi-Channel Agent

  The same Mastra Agent handles multiple channels (WhatsApp, Web, future IM) with channel-native structured responses using chat-sdk's `CardElement` as the universal format.

  ### sendCard Tool + Channel Constraints

  New Mastra tool with a flat, LLM-friendly schema that validates against per-channel constraints:

  | Channel         | Max Buttons | Max Label | Max Body     | Markdown |
  | --------------- | ----------- | --------- | ------------ | -------- |
  | WhatsApp        | 3           | 20 chars  | 1024 chars   | No       |
  | Web             | Unlimited   | 100 chars | 10,000 chars | Yes      |
  | Telegram (stub) | 8           | 64 chars  | 4,096 chars  | Yes      |

  The tool validates at call time and returns actionable error strings — the agent self-corrects via `maxSteps` retry.

  ### Channel Context Injection

  `RequestContext` from `@mastra/core/request-context` passed to `agent.generate()` and `agent.stream()` with channel type, conversation ID, and contact ID. Fixes a latent bug where memory/moderation processors didn't fire for channel sessions.

  ### CardElement Extraction Pipeline

  `extractSendCardResults()` inspects `response.steps` for `send_card` tool results via Mastra's `ToolResultChunk.payload` shape, routes each `CardElement` through the existing `serializeCard()` → outbox pipeline. Zero changes needed to WhatsApp serialization.

  ### CardRenderer Component

  New ai-elements component maps `CardElement` to shadcn/ui with single-use buttons (disable after click), `readOnly` mode for admin, and graceful fallback for unknown element types.

  ### Chat Page Cleanup

  `chat.$endpointId.tsx` refactored from ~370 to ~120 lines — extracted `usePublicChat` hook, `MessagePartsRenderer`, `ThinkingMessage`, and `ToolCallPart` as shared components.

  ## Production Hardening

  - **Dead letter queue** — terminal outbox message store after max retries
  - **Outbox retry** with exponential backoff (2s → 32s, max 5 retries)
  - **Circuit breaker** per channel type (5 failure threshold, 60s open)
  - **Atomic contact upsert** with `ON CONFLICT (phone) DO UPDATE`
  - **Session degrade-and-retry** on Mastra Memory thread failure
  - **Atomic consultation transitions** (`WHERE status='pending'` guards)
  - **Agent fallback message** on `generate()` failure
  - **Structured logging** with timing for all major operations
  - **Composite/partial indexes** for outbox, sessions, consultations
  - Split monolithic `handlers.ts` into `handlers/` directory

  ## Admin Session View

  - **Channel badge** (WhatsApp/Web) on session header
  - **Delivery status** (queued/sent/delivered/read/failed) with color coding
  - **CardRenderer readOnly** for send_card tool calls in transcript
  - **Staff reply** saves to Mastra Memory, shown with blue label
  - **Visitor label** shows contact name instead of generic "Contact"
  - **Prose-sm typography** — compact markdown rendering

  ## Data Tables with Server-Side Filtering

  Installed `data-table-filters` registry blocks with full server-side filtering pipeline:

  - **Sessions table** — status/agent checkbox filters, timerange on startedAt, View/Pause/Retry actions
  - **Contacts table** — role checkbox filter, name input filter, clickable detail links
  - **Backend** — `createDrizzleHandler` for cursor pagination, faceted filtering, 3-pass filter strategy
  - **Frontend** — `useInfiniteQuery` with server-driven facets, sortable columns, infinite scroll

  ## Realistic Seed Data

  Faker-generated demo data with deterministic seed (42):

  - 48 contacts (customers, leads, staff) with SG phone numbers
  - 3 channel instances (WhatsApp Business, Web Chat, sandbox)
  - 80 sessions across all lifecycle states over 30 days
  - 299 outbox messages, 11 consultations, 5 dead letters

  ## Core: Webhook Hardening (patch)

  - Webhook JSON validation (400 on invalid JSON, 422 on wrong shape)
  - In-memory rate limiter for webhook endpoints (100 req/s/IP)
  - WhatsApp media size pre-check (25MB limit)
  - Webhook error classification (`adapter_parse_error` vs `event_processing_error`)
  - Platform signature edge case logging

  ## Codebase Quality

  - Fixed all type errors (10 → 0) and lint errors (31 → 0)
  - Explicit virtual route definitions for conversations sub-layouts
  - Regenerated `routeTree.gen.ts` with correct hierarchy
  - 22+ files auto-fixed for import ordering
  - Updated shadcn UI components after registry update

  ## Test Coverage

  | Area                            | Tests   |
  | ------------------------------- | ------- |
  | send-card tool                  | 9       |
  | channel-constraints             | 7       |
  | channel-reply extraction        | 9       |
  | CardRenderer component          | 10      |
  | Production hardening (12 files) | 206     |
  | **Total new tests**             | **241** |

## 0.22.0

### Minor Changes

- [`815d5f4`](https://github.com/vobase/vobase/commit/815d5f47e1dc5bafd982e9a44d3b8962f1d67c83) Thanks [@mdluo](https://github.com/mdluo)! - # Realtime SSE: Event-Driven Server-Push via LISTEN/NOTIFY

  ![Realtime SSE](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-sse-realtime-0.22.0.png)

  ## RealtimeService

  New core infrastructure service that bridges PostgreSQL LISTEN/NOTIFY to Server-Sent Events. Modules opt in by calling `ctx.realtime.notify()` after mutations — connected browsers receive events and automatically refetch stale data via TanStack Query invalidation.

  ### How It Works

  | Layer    | Component                   | What It Does                                                |
  | -------- | --------------------------- | ----------------------------------------------------------- |
  | Database | `NOTIFY vobase_events`      | PostgreSQL fires event on channel after mutation            |
  | Server   | `RealtimeService`           | Listens on `vobase_events`, fans out to all SSE subscribers |
  | Server   | `GET /api/events`           | SSE endpoint, session-authenticated, 25s heartbeat          |
  | Browser  | `useRealtimeInvalidation()` | Bridges SSE events to `queryClient.invalidateQueries()`     |

  ### Server API

  ```typescript
  // Fire-and-forget (outside transaction)
  await ctx.realtime.notify({
    table: "messaging-threads",
    id: thread.id,
    action: "insert",
  });

  // Transactional (NOTIFY fires only on commit, suppressed on rollback)
  await ctx.db.transaction(async (tx) => {
    await tx.insert(threads).values(newThread);
    await ctx.realtime.notify(
      { table: "messaging-threads", id: newThread.id, action: "insert" },
      tx
    );
  });
  ```

  ### Client Integration

  Zero per-query changes needed. The `useRealtimeInvalidation()` hook is mounted once in the app shell. It invalidates any TanStack Query whose `queryKey[0]` matches the NOTIFY payload's `table` field.

  On reconnect after a connection drop, all queries are invalidated as a safety net to catch missed events.

  ## Database Support

  | Environment       | LISTEN Path                                   | NOTIFY Path                                |
  | ----------------- | --------------------------------------------- | ------------------------------------------ |
  | PGlite (dev)      | Native `pg.listen()`                          | `db.execute(sql\`SELECT pg_notify(...)\`)` |
  | PostgreSQL (prod) | Dedicated `postgres.js` connection (`max: 1`) | Same Drizzle `db.execute` / `tx.execute`   |

  Both paths are internal to `createRealtimeService()` — module code never sees the branching.

  Boot failure degrades gracefully to a no-op service (notify is silent, subscribe is a no-op). The app works without realtime.

  ## SSE Endpoint

  `GET /api/events` — requires session cookie (better-auth). Returns `text/event-stream`.

  | Event        | Data                                                                | When                                                    |
  | ------------ | ------------------------------------------------------------------- | ------------------------------------------------------- |
  | `invalidate` | `{ "table": "messaging-threads", "id": "abc", "action": "insert" }` | After a module calls `ctx.realtime.notify()`            |
  | `ping`       | empty                                                               | Every 25 seconds (keep-alive within `idleTimeout: 255`) |

  ## Reference Implementation

  Messaging module handlers now emit NOTIFY after mutations:

  - `POST /threads` — transactional insert + notify
  - `DELETE /threads/:id` — transactional delete + notify
  - `POST /threads/:id/chat` — title update notify
  - `POST /contacts` — fire-and-forget notify

  ## Dependencies Added

  | Package    | Version | Purpose                                                                                                                                                                                |
  | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `postgres` | ^3.4.8  | Dedicated LISTEN connection for PostgreSQL (not needed for PGlite). Removable when `bun:sql` gains LISTEN/NOTIFY support (PR [#25511](https://github.com/vobase/vobase/issues/25511)). |

  ## Test Coverage

  - **8 unit tests** — RealtimeService roundtrip, unsubscribe, fan-out, shutdown, no-op fallback (`realtime.test.ts`)
  - **14 messaging handler tests** — updated with realtime mock, all passing (`handlers.test.ts`)
  - **301 total tests pass**, 0 fail across 30 files
  - **11 E2E tests** verified via curl: auth gate, SSE roundtrip, fan-out to multiple tabs, ping keep-alive, payload validation, disconnect resilience

## 0.21.0

### Minor Changes

- [`9a202d9`](https://github.com/vobase/vobase/commit/9a202d95e99483829e066c68ff3b257e5c4aa0df) Thanks [@mdluo](https://github.com/mdluo)! - # PostgreSQL Schema Isolation

  ## BREAKING CHANGES

  All database tables are now isolated into per-module PostgreSQL schemas instead of using table name prefixes. Existing databases require migration.

  | Schema      | Tables (old → new)                                                                                                                                                                                                        |
  | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `auth`      | `user`, `session`, `account`, `verification`, `apikey`, `organization`, `member`, `invitation` (unchanged — already bare names)                                                                                           |
  | `audit`     | `_audit_log` → `audit_log`, `_record_audits` → `record_audits`                                                                                                                                                            |
  | `infra`     | `_sequences` → `sequences`, `_channels_log` → `channels_log`, `_channels_templates` → `channels_templates`, `_integrations` → `integrations`, `_storage_objects` → `storage_objects`, `_webhook_dedup` → `webhook_dedup`  |
  | `messaging` | `msg_threads` → `threads`, `msg_outbox` → `outbox`, `msg_contacts` → `contacts`                                                                                                                                           |
  | `ai`        | `msg_mem_cells` → `mem_cells`, `msg_mem_episodes` → `mem_episodes`, `msg_mem_event_logs` → `mem_event_logs`, `ai_eval_runs` → `eval_runs`, `ai_workflow_runs` → `workflow_runs`, `ai_moderation_logs` → `moderation_logs` |
  | `kb`        | `kb_documents` → `documents`, `kb_chunks` → `chunks`, `kb_sources` → `sources`, `kb_sync_logs` → `sync_logs`                                                                                                              |
  | `mastra`    | All `mastra_*` tables (via `schemaName: 'mastra'` in PGliteStore)                                                                                                                                                         |

  ### API Changes

  - `authSchema` renamed to `authTableMap` (the plain object passed to better-auth's drizzle adapter)
  - New exports from `@vobase/core`: `authPgSchema`, `auditPgSchema`, `infraPgSchema`
  - All Drizzle table variable names unchanged (`authUser`, `auditLog`, `msgThreads`, etc.)

  ### Migration for Existing Projects

  Projects created from the template need a one-time migration. For fresh projects, `bun run db:push` handles everything automatically.

  ```sql
  -- 1. Create schemas
  CREATE SCHEMA IF NOT EXISTS "auth";
  CREATE SCHEMA IF NOT EXISTS "audit";
  CREATE SCHEMA IF NOT EXISTS "infra";
  CREATE SCHEMA IF NOT EXISTS "messaging";
  CREATE SCHEMA IF NOT EXISTS "ai";
  CREATE SCHEMA IF NOT EXISTS "kb";
  CREATE SCHEMA IF NOT EXISTS "mastra";

  -- 2. Move tables (core)
  ALTER TABLE "user" SET SCHEMA "auth";
  ALTER TABLE "session" SET SCHEMA "auth";
  ALTER TABLE "account" SET SCHEMA "auth";
  ALTER TABLE "verification" SET SCHEMA "auth";
  ALTER TABLE "apikey" SET SCHEMA "auth";
  ALTER TABLE "organization" SET SCHEMA "auth";
  ALTER TABLE "member" SET SCHEMA "auth";
  ALTER TABLE "invitation" SET SCHEMA "auth";

  ALTER TABLE "_audit_log" SET SCHEMA "audit";
  ALTER TABLE "_record_audits" SET SCHEMA "audit";
  ALTER TABLE "audit"."_audit_log" RENAME TO "audit_log";
  ALTER TABLE "audit"."_record_audits" RENAME TO "record_audits";

  ALTER TABLE "_sequences" SET SCHEMA "infra";
  ALTER TABLE "_channels_log" SET SCHEMA "infra";
  ALTER TABLE "_channels_templates" SET SCHEMA "infra";
  ALTER TABLE "_integrations" SET SCHEMA "infra";
  ALTER TABLE "_storage_objects" SET SCHEMA "infra";
  ALTER TABLE "_webhook_dedup" SET SCHEMA "infra";
  ALTER TABLE "infra"."_sequences" RENAME TO "sequences";
  ALTER TABLE "infra"."_channels_log" RENAME TO "channels_log";
  ALTER TABLE "infra"."_channels_templates" RENAME TO "channels_templates";
  ALTER TABLE "infra"."_integrations" RENAME TO "integrations";
  ALTER TABLE "infra"."_storage_objects" RENAME TO "storage_objects";
  ALTER TABLE "infra"."_webhook_dedup" RENAME TO "webhook_dedup";

  -- 3. Move tables (template — adjust to your modules)
  ALTER TABLE "msg_threads" SET SCHEMA "messaging";
  ALTER TABLE "msg_outbox" SET SCHEMA "messaging";
  ALTER TABLE "msg_contacts" SET SCHEMA "messaging";
  ALTER TABLE "messaging"."msg_threads" RENAME TO "threads";
  ALTER TABLE "messaging"."msg_outbox" RENAME TO "outbox";
  ALTER TABLE "messaging"."msg_contacts" RENAME TO "contacts";

  ALTER TABLE "msg_mem_cells" SET SCHEMA "ai";
  ALTER TABLE "msg_mem_episodes" SET SCHEMA "ai";
  ALTER TABLE "msg_mem_event_logs" SET SCHEMA "ai";
  ALTER TABLE "ai_eval_runs" SET SCHEMA "ai";
  ALTER TABLE "ai_workflow_runs" SET SCHEMA "ai";
  ALTER TABLE "ai_moderation_logs" SET SCHEMA "ai";
  ALTER TABLE "ai"."msg_mem_cells" RENAME TO "mem_cells";
  ALTER TABLE "ai"."msg_mem_episodes" RENAME TO "mem_episodes";
  ALTER TABLE "ai"."msg_mem_event_logs" RENAME TO "mem_event_logs";
  ALTER TABLE "ai"."ai_eval_runs" RENAME TO "eval_runs";
  ALTER TABLE "ai"."ai_workflow_runs" RENAME TO "workflow_runs";
  ALTER TABLE "ai"."ai_moderation_logs" RENAME TO "moderation_logs";

  ALTER TABLE "kb_documents" SET SCHEMA "kb";
  ALTER TABLE "kb_chunks" SET SCHEMA "kb";
  ALTER TABLE "kb_sources" SET SCHEMA "kb";
  ALTER TABLE "kb_sync_logs" SET SCHEMA "kb";
  ALTER TABLE "kb"."kb_documents" RENAME TO "documents";
  ALTER TABLE "kb"."kb_chunks" RENAME TO "chunks";
  ALTER TABLE "kb"."kb_sources" RENAME TO "sources";
  ALTER TABLE "kb"."kb_sync_logs" RENAME TO "sync_logs";
  ```

  ## Schema Quality Improvements

  Bundled with the schema isolation work:

  - **FK indexes** on auth tables: `apikey(userId)`, `member(userId, organizationId)`, `invitation(organizationId, inviterId)`
  - **Partial indexes**: `outbox_queued_idx`, `mem_cells_pending_idx`, `documents_pending_idx` — smaller and faster than full status indexes
  - **Composite index**: `threads(userId, channel)` for filtered thread lookups
  - **CHECK constraints**: `mem_cells`, `mem_episodes`, `mem_event_logs` require `contactId IS NOT NULL OR userId IS NOT NULL`
  - **$onUpdate**: `workflow_runs.updatedAt` now auto-updates via Drizzle's `$onUpdate`
  - **Extension ordering**: SQL extension files renamed with numeric prefixes (`01_pgcrypto`, `02_vector`, `03_nanoid`) to enforce deterministic load order

## 0.20.0

### Minor Changes

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

## 0.19.1

### Patch Changes

- [`73b9885`](https://github.com/vobase/vobase/commit/73b988577c1d7103602c6211f5956e160570db13) Thanks [@mdluo](https://github.com/mdluo)! - # Mastra Agents: Declarative AI with Multi-Provider Streaming

  ![Mastra Agents](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-mastra-agents-0.19.0.png)

  ## Declarative Agent Definitions

  The messaging module's backend AI orchestration now uses [Mastra](https://mastra.ai) instead of raw AI SDK calls. Agents are defined declaratively — model, tools, and instructions in one place — instead of scattered `streamText()` and `generateText()` calls.

  ```typescript
  import { Agent } from "@mastra/core/agent";
  import { createTool } from "@mastra/core/tools";

  const agent = new Agent({
    id: "chat-support",
    name: "Support Bot",
    instructions: "You are a helpful assistant...",
    model: "openai/gpt-5-mini",
    tools: { search_knowledge_base: kbTool },
    defaultOptions: { maxSteps: 5 },
  });
  ```

  Two factory functions create agents from DB config:

  | Factory                     | Use case        | Execution          | Tools                              |
  | --------------------------- | --------------- | ------------------ | ---------------------------------- |
  | `createChatAgent()`         | Web chat        | `agent.stream()`   | Knowledge base search              |
  | `createChannelReplyAgent()` | WhatsApp, email | `agent.generate()` | Knowledge base search + escalation |

  ## Multi-Provider Model Resolution

  `toMastraModelId()` maps short model IDs to Mastra's `provider/model` format:

  | Input               | Output                            |
  | ------------------- | --------------------------------- |
  | `gpt-5-mini`        | `openai/gpt-5-mini`               |
  | `claude-3-5-sonnet` | `anthropic/claude-3-5-sonnet`     |
  | `gemini-2.0-flash`  | `google/gemini-2.0-flash`         |
  | `openai/gpt-5-mini` | `openai/gpt-5-mini` (passthrough) |

  ## Streaming Bridge

  Mastra agent output bridges to AI SDK's `useChat` frontend via `@mastra/ai-sdk`:

  ```
  agent.stream(messages) → toAISdkStream(result) → createUIMessageStreamResponse({ stream })
  ```

  The frontend (`useChat` from `@ai-sdk/react`) requires zero changes.

  ## Tool Migration

  Tools converted from AI SDK `tool()` to Mastra `createTool()`:

  - **search_knowledge_base** — RAG tool with hybrid search, now includes explicit `outputSchema`
  - **escalate_to_staff** — Human handoff tool, now includes `id` and `outputSchema`

  ## Eval Scorers

  New `evals.ts` exports a scorer suite using `@mastra/evals` for LLM-as-judge evaluation:

  - **Answer Relevancy** — measures response relevance to the user's question
  - **Faithfulness** — measures whether the response is grounded in provided context

  Scorers are designed for async evaluation (background jobs), not the request path.

  ## Chat Endpoint Guards

  New validation in the chat handler:

  - Returns **400** when thread has no agent assigned
  - Returns **404** for missing threads (was silently failing)
  - Improved error logging for background text persistence failures

  ## Dependencies Added

  | Package          | Purpose                                          |
  | ---------------- | ------------------------------------------------ |
  | `@mastra/core`   | Agent class, createTool, model routing           |
  | `@mastra/ai-sdk` | `toAISdkStream` bridge to AI SDK UIMessageStream |
  | `@mastra/evals`  | Answer relevancy + faithfulness scorers          |

  ## What Stayed on AI SDK

  - Frontend: `useChat` from `@ai-sdk/react` (unchanged)
  - Embeddings: `embed()` / `embedMany()` in knowledge-base (unchanged)
  - HyDE + re-ranking: `generateText()` in search.ts (unchanged)
  - UI types: `UIMessage` from `ai` package (unchanged)

  ## Test Coverage

  - `agents.test.ts` — 7 tests for `toMastraModelId` (provider mapping, passthrough, unknown prefix warning)
  - `handlers.test.ts` — 4 new tests for chat endpoint guards (no agent, not found, AI not configured, message persistence + auto-title)

## 0.19.0

### Minor Changes

- [`8cbf560`](https://github.com/vobase/vobase/commit/8cbf5604ec6cfbdedcec4373dda596a0e114c0e9) Thanks [@mdluo](https://github.com/mdluo)! - Upgrade pg-boss to v12 and @electric-sql/pglite to v0.4. Move both to peerDependencies so consumers stay version-aligned.

  **pg-boss 12 breaking changes handled:**

  - Named export (`import { PgBoss }`) — default export removed
  - Queue names normalized from `module:job` to `module/job` (colon no longer allowed)
  - `SendOptions` imported directly instead of `PgBoss.SendOptions`

  **PGlite 0.4:**

  - No API changes needed. Test helper added with golden dump pattern (`createTestPGlite()`) to avoid WASM OOM from parallel initdb — test suite 48s → 17s.

  **Platform contract:**

  - Generalized `POST /api/integrations/:provider/configure` with pass-through body envelope (frozen V1 contract)

## 0.18.0

### Minor Changes

- [`a75cfc3`](https://github.com/vobase/vobase/commit/a75cfc3977476b4a1b68b38f4e1e85da0ce81885) Thanks [@mdluo](https://github.com/mdluo)! - Fix platform OAuth integration flow (3 bugs found during e2e testing):

  - Mount platform auth routes before better-auth catch-all so `/api/auth/platform-callback` is reachable
  - Use `signUpEmail()` instead of `createUser()` (which requires the admin plugin) when creating platform users
  - Sign session cookie with HMAC-SHA256 to match better-auth's signed cookie format, and use explicit `Response` for redirect to preserve `Set-Cookie` header

  Also replace `packages/template/CLAUDE.md` symlink with a real file to prevent broken symlinks when GitHub creates repos from the template.

## 0.17.0

### Minor Changes

- [`ec6696f`](https://github.com/vobase/vobase/commit/ec6696fb24d22555f451c2d2c37345f60bb2564d) Thanks [@mdluo](https://github.com/mdluo)! - Add platform integration infrastructure: OAuth proxy callback, webhook signature verification, token refresh delegation, and createPlatformSession auth adapter method.

## 0.16.0

### Minor Changes

- [`ec6696f`](https://github.com/vobase/vobase/commit/ec6696fb24d22555f451c2d2c37345f60bb2564d) Thanks [@mdluo](https://github.com/mdluo)! - # Platform Integration Infrastructure

  Adds opt-in infrastructure for vobase-platform proxy integration — enabling managed OAuth, webhook forwarding, and credential provisioning for multi-tenant deployments.

  ## Platform Session Auth

  New `createPlatformSession()` on the AuthAdapter contract creates trusted sessions for users authenticated via the platform OAuth proxy. The platform verifies identity via JWT signed with HMAC-SHA256 — core validates the signature and creates a session directly without email/password auth.

  - `GET /api/auth/platform-callback?token=JWT` — accepts signed handoff JWT, creates or finds user, returns session cookie
  - New users get a strong random password (never used — auth is always via platform JWT)
  - 30-day session expiry matching better-auth defaults

  Activated when `PLATFORM_HMAC_SECRET` env var is set. No-op otherwise.

  ## Platform-Proxied Webhook Verification

  The channels webhook handler now accepts `X-Platform-Signature` as an alternative verification method for webhooks forwarded by vobase-platform.

  Security hardening: platform signature is only accepted when provider-specific signature headers (`X-Hub-Signature-256`, `Stripe-Signature`) are **absent**. This prevents an attacker who compromised the platform secret from bypassing provider-specific verification on direct webhooks.

  ## Dual-Mode Integration Token Auto-Refresh

  Automatic OAuth token refresh for integrations with two modes:

  | Mode         | When                                                                | How                                      |
  | ------------ | ------------------------------------------------------------------- | ---------------------------------------- |
  | **Local**    | Integration config has `clientId` + `clientSecret` + `refreshToken` | Refreshes directly with provider API     |
  | **Platform** | `PLATFORM_HMAC_SECRET` + `PLATFORM_URL` set                         | Delegates to vobase-platform token vault |

  Built-in provider support:

  | Provider Family | Token Endpoint                | Providers                                |
  | --------------- | ----------------------------- | ---------------------------------------- |
  | Google          | `oauth2.googleapis.com/token` | Google Workspace, Gmail, Google Calendar |
  | Microsoft       | `login.microsoftonline.com`   | Microsoft 365, Outlook, Teams            |

  Extensible via `registerProviderRefresh(provider, fn)` for custom OAuth providers.

  The `integrations:refresh-tokens` job runs every 5 minutes, scanning for tokens expiring within 10 minutes and refreshing them in the appropriate mode.

  ### New Exports

  - `verifyPlatformSignature(rawBody, signature)` — HMAC-SHA256 verification
  - `isPlatformEnabled()` — check if platform integration is active
  - `getRefreshMode(config)` — returns `'local'` | `'platform'` | `null`
  - `registerProviderRefresh(provider, fn)` — register custom provider refresh
  - `getProviderRefreshFn(provider)` — get refresh function for a provider

  ## WhatsApp Configuration Endpoint

  `POST /api/integrations/whatsapp/configure` accepts WhatsApp Business API credentials pushed from the platform after Embedded Signup completes. Platform-signed, creates or updates the WhatsApp integration record.

  ## Template Changes

  - Streamlined Dockerfile (removed unused stubs directory copy)
  - Refactored db scripts: replaced `db-commit.ts`/`db-current.ts` with cleaner `db-generate.ts`/`db-push.ts`
  - Updated `.env.example` with `PLATFORM_HMAC_SECRET` and `PLATFORM_URL`
  - Switched from `railway.toml` to `railway.json` for Railway deployment config
  - Added template-level `biome.json` extending root config

## 0.15.1

### Patch Changes

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

## 0.15.0

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

## 0.14.1

### Patch Changes

- [`2f94bdd`](https://github.com/vobase/vobase/commit/2f94bdd7ccc2759807b9c7be209afe67e1904252) Thanks [@mdluo](https://github.com/mdluo)! - # v0.14 Post-Release Cleanup

  ## Breaking Changes

  - `StorageProvider` renamed to `StorageAdapter`
  - `createLocalProvider` renamed to `createLocalAdapter`
  - `createS3Provider` renamed to `createS3Adapter`
  - `StorageProviderConfig`, `LocalProviderConfig`, `S3ProviderConfig` renamed to `StorageAdapterConfig`, `LocalAdapterConfig`, `S3AdapterConfig`
  - `_notify` module removed (use `_channels` instead)
  - `_credentials` module removed (use `_integrations` instead)

  ## What Changed

  Cleaned up duplication and naming inconsistencies from v0.14. The `_notify` module (7 files) was fully superseded by `_channels` — three duplicated adapters and two log tables removed. The `_credentials` module (3 files) was fully superseded by `_integrations` — same encryption, richer schema.

  Unified all pluggable implementation naming to "adapter": storage directory renamed from `providers/` to `adapters/`, and all interface/function names updated (`StorageProvider` → `StorageAdapter`, `createLocalProvider` → `createLocalAdapter`, etc.). Now consistent with channels (`ChannelAdapter`, `createResendAdapter`).

  Relocated orphaned `middleware/audit.test.ts` to `modules/audit/middleware.test.ts`.

  ## Migration

  Replace in your imports:

  - `StorageProvider` → `StorageAdapter`
  - `createLocalProvider` → `createLocalAdapter`
  - `createS3Provider` → `createS3Adapter`
  - `StorageProviderConfig` → `StorageAdapterConfig`
  - `LocalProviderConfig` → `LocalAdapterConfig`
  - `S3ProviderConfig` → `S3AdapterConfig`

  If using `_notify`: switch to `_channels`. `ctx.channels.email.send()` replaces `ctx.notify.email.send()`.

## 0.14.0

### Minor Changes

- [`d33b998`](https://github.com/vobase/vobase/commit/d33b998b9a538105acbda104db5d1bc25e248974) Thanks [@mdluo](https://github.com/mdluo)! - # Channels, Messaging & Type Safety

  ![Channels & Messaging](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-channels-messaging-v0.14.png)

  ## Channels Module (Core)

  New built-in `_channels` module provides a unified multi-channel messaging infrastructure with pluggable adapters.

  ### Channel Adapters

  | Adapter      | Transport       | Features                                                                                                                                                                                                                        |
  | ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **WhatsApp** | Cloud API v22.0 | Text, image, document, audio, video, sticker, location, contacts, interactive (buttons/lists), reactions, status updates, media download/upload, message chunking (4096 char limit), signature verification, error code mapping |
  | **Resend**   | REST API        | HTML email via Resend                                                                                                                                                                                                           |
  | **SMTP**     | nodemailer      | HTML email via SMTP relay                                                                                                                                                                                                       |

  ### Contracts

  - `ChannelAdapter` — pluggable adapter interface (`send`, `parseWebhook`)
  - `ChannelEvent` — discriminated union: `MessageReceivedEvent | StatusUpdateEvent | ReactionEvent`
  - `ChannelsService` — adapter registry with `registerAdapter()`, `send()`, `parseWebhook()`, event bus
  - `ChannelEventEmitter` — typed event emitter for `message_received`, `status_update`, `reaction`

  ### WhatsApp Adapter Details

  - Full Embedded Signup flow (code exchange, WABA/phone resolution, webhook subscription)
  - Media handling: downloads WhatsApp-hosted media (URLs expire in ~5 min), uploads via `form-data`
  - Message chunking: splits long messages at sentence boundaries respecting the 4096 char API limit
  - Error mapping: WhatsApp error codes mapped to structured `WhatsAppApiError` with `retryable` flag
  - Signature verification: HMAC-SHA256 validation of webhook payloads
  - 65 unit tests covering all message types, status updates, reactions, error scenarios

  ## Integrations Module (Core)

  New built-in `_integrations` module provides encrypted credential storage for external service connections.

  - `IntegrationsService` — connect, disconnect, get active integration, update config
  - AES-256-GCM encryption for credentials at rest (access tokens, app secrets)
  - Schema: `_integrations` table with provider, status, encrypted credentials, config metadata
  - Designed for OAuth flows where tokens need secure persistence

  ## Messaging Module (Template)

  New `messaging` module replaces the previous `chatbot` module with full multi-channel support.

  ### Architecture

  - **Agents**: Configurable AI agents with model selection, system prompts, tools, KB integration, and channel assignment
  - **Threads**: Conversations between users/contacts and agents, scoped by channel (web, whatsapp)
  - **Contacts**: External contact management (phone, email, name, channel)
  - **Messages**: Bidirectional message store with direction (inbound/outbound), sender type (user/agent/contact/staff), AI role tracking

  ### Channel Handler Pipeline

  1. Inbound message received via webhook
  2. Find or create contact from sender identity
  3. Find or create thread (contact + channel + agent)
  4. Upload media attachments to storage (WhatsApp URLs expire)
  5. Store message with attachment metadata
  6. If thread status is `ai`, queue debounced reply (3s batching)
  7. AI agent processes conversation, streams response
  8. Outbound message queued via outbox pattern

  ### Additional Features

  - Staff-sent detection: messages sent from WhatsApp Business App pause AI and set resume to next 9am
  - Thread status machine: `ai` | `human` | `paused` with manual resume endpoint
  - Outbound message queue with delivery status tracking
  - AI escalation detection via tool calling
  - Zod validation on all 7 POST/PUT handlers

  ## Integrations Module (Template)

  New `integrations` module handles WhatsApp Embedded Signup OAuth flow.

  - Frontend: Facebook SDK lazy loading, popup-based OAuth, real-time webhook status polling
  - Backend: Code exchange, WABA/phone number resolution, credential storage, adapter hot-reload
  - Post-signup job: webhook subscription, callback URL registration, phone number registration (with retry)
  - Uses Hono typed RPC client + TanStack Query (no raw fetch)

  ## Data Table System

  Replaced the previous data-grid with a faceted filter data table system.

  ### Components

  - `DataTableInfinite` — virtualized infinite-scroll table with TanStack Table
  - Filter controls: checkbox, input, slider, timerange with drawer layout
  - Cell renderers: badge, boolean, code, number, text, timestamp
  - Store sync: integrates with URL search params via `nuqs`
  - Provider pattern for table state management

  ### Table Schema DSL

  Type-safe schema definition for data tables:

  - `col()` builder with chainable methods: `.text()`, `.number()`, `.boolean()`, `.date()`, `.enum()`, `.badge()`
  - Auto-generates: TanStack columns, filter fields, filter schema, sheet fields
  - Serialization layer for URL-safe filter state
  - Preset system for common column patterns (id, timestamps, status, email)

  ## Type Safety & Quality Pass

  ### Eliminated `as any` (30+ instances)

  **Core production code:**

  - `mcp/crud.ts` — `ColumnMeta` interface for Drizzle column introspection, `Record<string, unknown>` for dynamic values, `catch (e: unknown)` with proper narrowing
  - `auth/index.ts` — `BetterAuthPlugin[]` typed array, `AuthApiWithVerifyApiKey` interface for API key verification

  **Core tests:**

  - `whatsapp.test.ts` — 22 casts replaced with `MessageReceivedEvent`, `StatusUpdateEvent`, `ReactionEvent`
  - `crud.test.ts` — `McpServerInternals` interface for MCP SDK internals
  - `permissions.test.ts` — proper `AuthUser` type
  - `drizzle-introspection.test.ts` — `ColumnMeta` interface

  **Template:**

  - `threads.tsx` — `TextUIPart` type predicate for AI message parts
  - `handlers.ts` — `UIMessage[]` typing, `TextUIPart` filter
  - `channel-handler.ts` — direct `event.messageType` access

  ### Raw SQL to Drizzle

  - `next-sequence.ts` — replaced `db.$client.prepare()` with `insert().onConflictDoUpdate().returning()`

  ### ZodError Global Handler

  - `errors.ts` — Zod validation errors now return 400 with `err.flatten()` details instead of generic 500

  ### Bug Fixes

  - **API key auth was silently broken**: `verifyApiKey` accessed `result.key.userId` which doesn't exist on the `ApiKey` type — fixed to use `result.key.referenceId`
  - **Thread data leak**: `GET /threads` returned all threads regardless of user — fixed to filter by `ctx.user.id`
  - **Thread access control**: `GET /threads/:id` allowed reading any thread — fixed to check ownership

  ## UI Updates

  - Refreshed shadcn/ui components (base-nova preset)
  - Updated shell: collapsible sidebar, breadcrumbs, command palette, mobile nav
  - Settings page: integrations tab with WhatsApp connect/disconnect/test
  - System logs page: faceted data table with audit log entries
  - Knowledge base connectors: Google Drive and SharePoint OAuth flows

  ## Dependencies

  | Package                | Purpose                           |
  | ---------------------- | --------------------------------- |
  | `@anthropic-ai/sdk`    | Claude model provider             |
  | `@better-auth/api-key` | API key authentication plugin     |
  | `nodemailer`           | SMTP email transport              |
  | `@diceui/sortable`     | Drag-and-drop sortable lists      |
  | `nuqs`                 | URL search param state management |

  ## Test Coverage

  - Core: 277 tests across 28 files (all pass)
  - Template: 93 tests across 10 files (68 pass, 25 pre-existing KB/sqlite-vec failures)
  - WhatsApp adapter: 65 tests covering all message types and error scenarios
  - Messaging handlers: 16 tests covering CRUD, chat, ownership

## 0.13.0

### Minor Changes

- [`a3e100a`](https://github.com/vobase/vobase/commit/a3e100a662db7cbf593ee9332344cf5d565232e9) Thanks [@mdluo](https://github.com/mdluo)! - # Template UI Overhaul: Linear-Quality Shell, AI Elements Chat, Settings & Auth Redesign

  ![Template UI Overhaul](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-template-ui-overhaul-0.13.0.png)

  Comprehensive frontend overhaul of the Vobase template — 90 files changed, +10,829/-1,003 lines across 20 commits. The template now ships with a Linear-quality app shell, AI Elements-powered chatbot, polished data pages, settings, and redesigned auth.

  ## Shell Redesign

  The app shell replaces the static 260px sidebar with a full-featured navigation system:

  | Feature             | Description                                                            |
  | ------------------- | ---------------------------------------------------------------------- |
  | Collapsible sidebar | Icon-only mode (52px) ↔ expanded (240px), persisted in localStorage    |
  | Grouped nav         | Sections per module (Overview, Chatbot, KB, System) with lucide icons  |
  | Breadcrumbs         | Route-aware breadcrumbs derived from TanStack Router `useMatches()`    |
  | Command palette     | Cmd+K fuzzy search across all pages via cmdk                           |
  | User menu           | Avatar dropdown in sidebar footer — settings, theme toggle, sign out   |
  | Mobile nav          | Slide-in drawer with backdrop, escape-to-close, body scroll lock       |
  | Theme toggle        | Light / Dark / System with immediate effect, persisted in localStorage |

  ## Chatbot UI with AI Elements + useChat

  The chatbot is now powered by Vercel AI SDK's `useChat` hook and AI Elements components:

  - **`useChat` + `DefaultChatTransport`** replaces manual fetch/reader/decoder streaming
  - **`toUIMessageStreamResponse()`** on the backend for proper UI message protocol
  - **AI Elements** components: `Conversation` (auto-scroll), `Message` + `MessageResponse` (Shiki syntax highlighting, GFM, math), `PromptInput` (auto-resize, status-aware submit), `CodeBlock`, `Shimmer` (loading indicator), `Suggestion` (quick-start chips)
  - **Split-pane layout**: 280px thread sidebar + conversation area
  - **Welcome screen**: greeting, assistant selector, configurable suggestion chips, inline input
  - **Assistant selector**: dropdown when multiple assistants exist, suggestions update per assistant
  - **`suggestions` field** on assistant schema — configurable quick-start prompts per assistant
  - **Auto-title**: thread title set from first user message
  - **Error toasts**: API key missing, model not found, generic failures surfaced via sonner
  - **Multi-provider routing**: `claude-*` → Anthropic, `gemini-*` → Google, `gpt-*` → OpenAI

  ```typescript
  // Backend: new /threads/:id/chat endpoint
  const result = await streamChat({ db: ctx.db, assistantId, messages });
  return result.toUIMessageStreamResponse();

  // Frontend: useChat handles everything
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/chatbot/threads/${id}/chat`,
    }),
    messages: initialMessages,
  });
  ```

  ## KB, System & Home Page Polish

  | Page         | Improvements                                                          |
  | ------------ | --------------------------------------------------------------------- |
  | Audit log    | Sortable DataTable with column visibility toggle, pagination          |
  | System ops   | 4 stat cards (version, health, DB, modules) + registered modules grid |
  | KB documents | File type icons, status badges, empty state with upload CTA           |
  | KB search    | Relevance progress bars, search term highlighting, skeleton cards     |
  | KB sources   | Status dots (green/yellow/red) with pulse animation, sync timestamps  |
  | Home         | Stat cards + recent activity table + quick-link cards to modules      |

  Shared components: `PageHeader`, `StatCard`, `EmptyState` — used consistently across all pages.

  ## Settings Page

  New `/settings` route with left nav:

  - **Profile**: user info from session, name/email form
  - **Appearance**: theme picker cards (Light/Dark/System) with immediate effect
  - **API Keys**: placeholder UI for future key management
  - **Organization**: progressive — shows only when `config.organization` is enabled

  ## Auth Pages Redesign

  Replaced the 2-column dark panel layout with a clean centered card:

  - Vobase wordmark above, copyright below
  - Polished form spacing, inline error display (`bg-destructive/10`)
  - Consistent login/signup styling

  ## Scripts & Seeding

  - **`bun run reset`**: wipe `data/`, push schema, seed — one command for fresh start
  - **`bun run seed`**: creates admin user + uploads real fixture files through the extraction pipeline via bunqueue (extract → chunk → embed → index)
  - **Module seed files**: `modules/chatbot/seed.ts` and `modules/knowledge-base/seed.ts` with faker-generated data
  - **Build script**: simplified to `tsc --noEmit` (Bun runs TypeScript directly, no bundling needed)

  ## Dependencies Added

  | Package                 | Purpose                                                        |
  | ----------------------- | -------------------------------------------------------------- |
  | `@ai-sdk/react`         | `useChat` hook for streaming chat UI                           |
  | `@ai-sdk/anthropic`     | Claude model support for chatbot                               |
  | `react-markdown`        | Markdown rendering (superseded by AI Elements MessageResponse) |
  | `shiki` + `streamdown`  | Syntax highlighting via AI Elements CodeBlock                  |
  | `use-stick-to-bottom`   | Auto-scroll for Conversation component                         |
  | `@faker-js/faker` (dev) | Realistic seed data generation                                 |

  ## Models Updated

  | Context            | Old                              | New                               |
  | ------------------ | -------------------------------- | --------------------------------- |
  | Default chat model | `gpt-4o-mini`                    | `gpt-5-mini`                      |
  | Seed assistants    | `gpt-4o-mini` / `gpt-4o`         | `gpt-5-mini` / `claude-haiku-4-5` |
  | OCR model          | `gemini-2.5-flash-preview-05-20` | `gemini-flash-latest`             |

  ## Bug Fixes

  - Card padding: removed redundant `pt-4/pt-5/pt-6` from CardContent across all pages
  - Empty threads: filtered from sidebar, "New Chat" shows welcome screen instead of creating empty thread
  - Shimmer loading: stays visible until first AI token arrives (no blank screen gap)
  - Auth origin: added `localhost:5174` to `trustedOrigins`
  - Seed sqlite-vec: added `setupSqliteVec()` call to seed script
  - Assistant card footer: replaced heavy CardFooter with inline buttons

## 0.12.0

### Minor Changes

- [`64f33ca`](https://github.com/vobase/vobase/commit/64f33ca5fdd858b669482a88c0ccb0bb1167882e) Thanks [@mdluo](https://github.com/mdluo)! - # Knowledge Base: Document Extraction + Hybrid Search

  ![Vobase Knowledge Base v0.12.0](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-kb-extraction-0.12.0.png)

  ## Document Extraction Layer

  The knowledge base module now supports uploading and extracting text from **6 document formats** — PDF, DOCX, XLSX, PPTX, images, and HTML. Previously, only plain text files were supported and PDF uploads silently failed because the file content was never sent to the server.

  ### How it works

  Each format uses a best-of-breed local library for extraction, with Google Gemini 2.5 Flash as the OCR fallback for scanned documents and images:

  | Format        | Library                 | What it does                                                         |
  | ------------- | ----------------------- | -------------------------------------------------------------------- |
  | PDF (text)    | `unpdf`                 | Extracts text from digital PDFs locally, zero API calls              |
  | PDF (scanned) | Gemini 2.5 Flash        | Auto-detects scanned pages (<100 chars/page), sends to Gemini vision |
  | DOCX          | `mammoth` + `turndown`  | Converts Word docs to HTML, then to Markdown with headers/tables     |
  | XLSX          | `SheetJS`               | Parses Excel sheets into Markdown tables with sheet headers          |
  | PPTX          | `officeparser`          | Extracts slide text from PowerPoint presentations                    |
  | Images        | Gemini 2.5 Flash        | OCR via vision API — screenshots, photos, scanned documents          |
  | HTML          | `turndown` + GFM plugin | Converts HTML to Markdown preserving tables, lists, headings         |

  ### Async queue processing

  Document processing is now fully asynchronous via the job queue:

  1. **Upload handler** parses the multipart form, inserts a `pending` document record, writes the file to a temp location, and enqueues a processing job — response returns in <100ms
  2. **Queue job** reads the temp file, extracts text, runs chunking + embedding, inserts into vec0 + FTS5, and marks the document as `ready`
  3. **Temp cleanup** happens in a `finally` block — files are always deleted after processing

  ### Graceful OCR degradation

  If `GOOGLE_GENERATIVE_AI_API_KEY` is not set:

  - Text-based PDFs still work (local extraction via unpdf)
  - Scanned PDFs and images get a `needs_ocr` status with an amber badge and a warning message
  - No errors thrown — the system degrades gracefully

  ## Hybrid Search Improvements

  Search has been upgraded with three techniques inspired by [qmd](https://github.com/tobi/qmd) and [LightRAG](https://github.com/HKUDS/LightRAG):

  ### Reciprocal Rank Fusion (RRF)

  Replaced the fragile weighted-average score merging (`0.7 * vector + 0.3 * keyword`) with **Reciprocal Rank Fusion** (k=60). RRF is rank-based, not score-based — it doesn't depend on normalizing incompatible score distributions between vec0 distances and FTS5 ranks. The formula is simple: `RRF(d) = sum(1 / (k + rank_i(d)))` across all result lists.

  ### Search modes: fast and deep

  A new `mode` option controls search behavior:

  - **`fast`** (default) — RRF merges vector similarity + FTS5 keyword results. No LLM calls in the search path. Sub-300ms latency.
  - **`deep`** — Adds HyDE query expansion and optional LLM re-ranking. 3-4x more API calls but significantly better relevance. Used by the chatbot KB tool.

  ### HyDE (Hypothetical Document Embedding)

  In deep mode, the search generates a hypothetical answer to the query via `generateText()`, embeds that answer, and runs an additional vector search. The hypothetical answer is often closer in embedding space to relevant chunks than the original question — this dramatically improves recall for complex queries.

  Three rank lists (semantic, HyDE, FTS5) are merged via RRF.

  ### LLM Re-ranking

  Optional post-RRF step: sends the top candidates to an LLM with "rank these passages by relevance" and re-orders the results. Enabled via `rerank: true` in search options.

  All LLM calls in the search path have try/catch with graceful degradation — if HyDE or re-ranking fails, search falls back to the simpler path automatically.

  ## Chatbot KB Integration

  The chatbot's knowledge base tool now uses **deep mode** search by default, giving it access to HyDE query expansion and RRF fusion for better document retrieval during conversations.

  ## Frontend Changes

  - **File picker** now accepts `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.html`, `.txt`, `.md`, `.csv`
  - **Upload** sends actual file bytes via `FormData` (previously only sent filename as JSON)
  - **`needs_ocr` status** shows an amber badge when OCR is needed but no API key is configured
  - **`vectorWeight`/`keywordWeight`** options are deprecated (kept for backward compatibility, ignored internally)

  ## Dependencies Added

  - `mammoth` — DOCX to HTML conversion
  - `turndown` + `turndown-plugin-gfm` — HTML to Markdown with GFM tables
  - `xlsx` — Excel parsing (SheetJS)
  - `officeparser` — PPTX text extraction
  - `@ai-sdk/google` — Gemini provider for Vercel AI SDK

  ## Bug Fixes

  - Fixed `created_at` NOT NULL constraint in pipeline raw SQL insert
  - Fixed `officeparser` v6 API change (returns AST with `.toText()`, not string)
  - Fixed HTML MIME type matching for `text/html;charset=utf-8`
  - Fixed `sqlite-vec` extension path resolution in Bun monorepo
  - Fixed `GEMINI_API_KEY` env var compatibility (now checks both `GOOGLE_GENERATIVE_AI_API_KEY` and `GEMINI_API_KEY`)

  ## Test Coverage

  - 13 extraction tests with real document fixtures (PDF, DOCX, XLSX, PPTX, HTML, images)
  - 15 search tests covering RRF scoring, fast/deep modes, HyDE, re-ranking, graceful degradation
  - 16 handler tests including multipart upload, job enqueue, and error cases
  - 12 chunker tests (unchanged)

## 0.11.0

### Minor Changes

- [`e75eb69`](https://github.com/vobase/vobase/commit/e75eb695a551479697d77a731311d118eea5e3c7) Thanks [@mdluo](https://github.com/mdluo)! - ### Breaking: `createApp()` is now async

  `createApp()` returns a `Promise` instead of a synchronous result. Update your `server.ts`:

  ```ts
  // Before
  const app = createApp({ ...config, modules });

  // After
  const app = await createApp({ ...config, modules });
  ```

  This change enables dynamic imports of bunqueue and MCP SDK, reducing cold-start overhead when these features aren't used.

  ### New: Auth schema table exports

  All auth schema tables are now exported from `@vobase/core`:

  ```ts
  import {
    authUser,
    authSession,
    authAccount,
    authVerification,
    authApikey,
    authOrganization,
    authMember,
    authInvitation,
  } from "@vobase/core";
  ```

  This eliminates the need for `db-schemas.ts` barrel files in template projects. `drizzle.config.ts` can point directly at core's schema source files — `bunfig.toml` forces Bun runtime for drizzle-kit, so `bun:sqlite` resolves natively.

  ### New: Source-first package exports

  Package exports now point to `src/index.ts` instead of `dist/`. Bun resolves TypeScript directly, removing the build step for local development. The `build` script now runs `tsc --noEmit` (typecheck only).

  ### Fix: Storage download route

  Fixed `Response` constructor in storage download route to pass `ArrayBuffer` instead of `Uint8Array` for Bun compatibility.

  ### Template: AI example modules

  The template now ships with two AI-powered example modules alongside the existing system module:

  - **Knowledge Base** — Document management with vector embeddings (sqlite-vec), chunking pipeline, hybrid search (KNN + FTS5), and connectors (web crawl, Google Drive, SharePoint)
  - **Chatbot** — AI chat with assistants and threads, streaming responses via Vercel AI SDK, tool-augmented generation with RAG from knowledge base

  Supporting infrastructure:

  - `lib/sqlite-vec.ts` — Optional vector extension loader with graceful fallback
  - `lib/ai.ts` — Vercel AI SDK provider configuration
  - `lib/schema-helpers.ts` — Shared nanoid primary key and timestamp helpers
  - SearchBar combobox component with animated placeholder text
  - Type-safe TanStack Router navigation with `beforeLoad` redirects on layout routes
  - Storage enabled with `kb-documents` and `chat-attachments` buckets
  - Credentials store enabled for API key management

## 0.10.0

### Minor Changes

- [`cc4c59e`](https://github.com/vobase/vobase/commit/cc4c59e2a5a64f5935e2ef334dacf0b8fbb94fdb) Thanks [@mdluo](https://github.com/mdluo)! - Add RBAC support with role guards, API key auth, and optional organization/team support. Reorganize core source into mcp/ and infra/ subdirectories. Add module-aware MCP CRUD tools with API key authentication. Schema tables for apikey (always), organization/member/invitation (opt-in).

  ### New features

  - **better-auth plugins**: Wire `@better-auth/api-key` (always) and `organization` (opt-in via `config.auth.organization`) plugins into the auth module
  - **RBAC middlewares**: `requireRole()`, `requirePermission()`, `requireOrg()` exported from `@vobase/core` for route-level authorization
  - **API key auth for MCP**: MCP endpoint validates API keys via `Authorization: Bearer <key>`. Discovery tools available without auth; CRUD tools require valid API key.
  - **MCP CRUD tools**: Auto-generated list/get/create/update/delete tools per module from Drizzle schema, gated on API key authentication
  - **Organization support**: Opt-in via `config.auth.organization` — adds organization, member, invitation tables
  - **Permission contracts**: `Permission` and `OrganizationContext` TypeScript interfaces

  ### Breaking changes

  - `AuthUser` and `VobaseUser` types now include optional `activeOrganizationId` field
  - `AuthModule` type now includes `verifyApiKey()` and `organizationEnabled` fields
  - `McpDeps` interface now accepts optional `verifyApiKey` and `organizationEnabled`
  - Core source files moved: `src/mcp.ts` → `src/mcp/server.ts`, `src/errors.ts` → `src/infra/errors.ts`, etc. (barrel re-exports preserve public API)
  - New peer dependency: `@better-auth/api-key@^1.5.0`

## 0.9.0

### Minor Changes

- [`ab63ba9`](https://github.com/vobase/vobase/commit/ab63ba9ac2b6842c418d4bcbf358f4cdcaea1758) Thanks [@mdluo](https://github.com/mdluo)! - Add RBAC support with role guards, API key auth, and optional organization/team support. Reorganize core source into mcp/ and infra/ subdirectories. Add module-aware MCP CRUD tools. Schema tables for apikey (always), organization/member/invitation (opt-in).

  ### New features

  - **RBAC middlewares**: `requireRole()`, `requirePermission()`, `requireOrg()` for declarative route-level authorization
  - **API key schema**: Always included in `getActiveSchemas()` for MCP and programmatic access
  - **Organization support**: Opt-in via `getActiveSchemas({ organization: true })` — adds organization, member, invitation tables
  - **MCP CRUD tools**: Auto-generated list/get/create/update/delete tools per module from Drizzle schema
  - **Permission contracts**: `Permission` and `OrganizationContext` TypeScript interfaces

  ### Breaking changes

  - `AuthUser` and `VobaseUser` types now include optional `activeOrganizationId` field
  - Core source files moved: `src/mcp.ts` → `src/mcp/server.ts`, `src/errors.ts` → `src/infra/errors.ts`, etc. (barrel re-exports preserve public API)

## 0.8.0

### Minor Changes

- [`87891b5`](https://github.com/vobase/vobase/commit/87891b52d117a20638f086df970b0f0e3b703428) Thanks [@mdluo](https://github.com/mdluo)! - Extract auth, storage, and notify into built-in modules with config-driven boot. Auth uses an `AuthAdapter` interface, storage provides a virtual bucket model (`StorageService` + `BucketHandle`) with local and S3 providers, and notify offers channel-based delivery (email via Resend/SMTP, WhatsApp via WABA) with automatic logging. Template syncs `db-schemas.ts` with new core tables and fixes pagination, login UI, and dark mode sidebar color.

## 0.7.0

### Minor Changes

- [`8c126c9`](https://github.com/vobase/vobase/commit/8c126c96b128a2a1b11d556e93ea2f11f07ef7e7) Thanks [@mdluo](https://github.com/mdluo)! - Phase 1 architecture rethink: extract built-in modules, config-driven boot, core contracts

  **Breaking changes:**

  - `ensureCoreTables()` and `runMigrations()` removed — tables are now managed by drizzle-kit
  - `createSystemModule()`, `createSystemRoutes()` removed — system module moved to template
  - `credentialsTable`, `ensureCredentialTable()` removed — use `createCredentialsModule()` with `config.credentials.enabled`
  - `auditLog`, `recordAudits`, `sequences` now exported from built-in module paths
  - `createApp()` no longer auto-creates tables or runs migrations at boot
  - Standalone `sequence.ts`, `audit.ts`, `credentials.ts` deleted — functionality moved to `modules/` subdirectories

  **New features:**

  - `defineBuiltinModule()` factory for internal `_`-prefixed modules
  - Module `init` hook: `init(ctx: ModuleInitContext)` called at boot
  - Core contracts: `StorageProvider`, `EmailProvider`, `AuthAdapter`, `ModuleInitContext`
  - `createThrowProxy<T>()` for unconfigured service placeholders
  - `getActiveSchemas()` for conditional drizzle-kit schema inclusion
  - Webhook dedup migrated from raw SQL to Drizzle ORM
  - Empty schema (`{}`) now allowed for modules without tables

  **Template changes:**

  - System module now lives in `modules/system/` as a regular user module
  - `db-schemas.ts` barrel provides core table schemas to drizzle-kit (Node.js compatible)

## 0.6.2

### Patch Changes

- [`77016c6`](https://github.com/vobase/vobase/commit/77016c6964647e87eae5ff4bc962a0e82f5aefdb) Thanks [@mdluo](https://github.com/mdluo)! - Stub better-sqlite3 so drizzle-kit uses bun:sqlite driver; clean up seed script output

## 0.6.1

### Patch Changes

- [`6d3049c`](https://github.com/vobase/vobase/commit/6d3049c0cf483416187cace805ff840690ffed1f) Thanks [@mdluo](https://github.com/mdluo)! - Harden credential store encryption (scryptSync KDF, Buffer handling, ciphertext validation), fix db-migrate mkdir guard and rewrite tests with real SQLite databases, and fix create-vobase giget bundling with --packages=external.

## 0.6.0

### Minor Changes

- [`4e46139`](https://github.com/vobase/vobase/commit/4e461395eab8add4e1a41ba9dd6c3c7de1466204) Thanks [@mdluo](https://github.com/mdluo)! - Expose `auth` option in `CreateAppConfig` to pass social providers and other auth config through to `createAuth`

## 0.5.0

### Minor Changes

- [`71cc62a`](https://github.com/vobase/vobase/commit/71cc62a55e14299e16154cb03c067b8b61bf8053) Thanks [@mdluo](https://github.com/mdluo)! - Add `socialProviders` option to `createAuth` for configuring OAuth social login providers (Google, GitHub, etc.) via better-auth

## 0.4.1

## 0.4.0

## 0.3.0

## 0.2.0

### Minor Changes

- [`bd9b3c4`](https://github.com/vobase/vobase/commit/bd9b3c4d5cf4da012ad378c03b6094a4908f2da1) Thanks [@mdluo](https://github.com/mdluo)! - Reposition vobase from ERP engine to general app framework built for AI coding agents

  - Rewrite README with new positioning: "own every line, your AI already knows how to build on it"
  - Replace ERP-specific examples with general business app examples (SaaS, internal tools, CRM, project trackers)
  - New comparison table: vs Supabase (simplicity), Pocketbase (transparency), Rails/Laravel (AI-native)
  - Remove ERP branding from all skill files, manifest, CLAUDE.md, template AGENTS.md, and CLI README
  - Reframe core skills (integer-money, status-machines, gap-free-sequences) as universal app patterns

## 0.1.10

### Patch Changes

- [`a1036b0`](https://github.com/vobase/vobase/commit/a1036b078877f9870f2e8e883d78298c9df7da76) Thanks [@mdluo](https://github.com/mdluo)! - fix: include app routes in generate, add baseURL to auth, copy .env on init

## 0.1.9

### Patch Changes

- [`1421074`](https://github.com/vobase/vobase/commit/14210745b50ba8acb8d8843deb92224eea099d5b) Thanks [@mdluo](https://github.com/mdluo)! - fix: track template src/data by scoping gitignore data/ to root only

## 0.1.8

### Patch Changes

- [`02e2604`](https://github.com/vobase/vobase/commit/02e260484fd132d2f6daec509a716f3869b5da48) Thanks [@mdluo](https://github.com/mdluo)! - fix: only skip data/dist/node_modules at root level during post-processing

## 0.1.7

### Patch Changes

- [`bf7bc85`](https://github.com/vobase/vobase/commit/bf7bc859f7dad9cdc6042228bf62ba89352d244c) Thanks [@mdluo](https://github.com/mdluo)! - feat: support `vobase init` in current directory with git-clean safety check

## 0.1.6

### Patch Changes

- [`9c1f3a2`](https://github.com/vobase/vobase/commit/9c1f3a28ffc5453045ee46bd2260db3d6cf8b970) Thanks [@mdluo](https://github.com/mdluo)! - feat: run drizzle-kit push during init for zero-config setup

## 0.1.5

### Patch Changes

- [`42b92e5`](https://github.com/vobase/vobase/commit/42b92e550482a73e8da88f1da172c103d5d9ed39) Thanks [@mdluo](https://github.com/mdluo)! - fix: remove misleading @better-auth/cli generate step from init output

## 0.1.4

### Patch Changes

- feat: fetch template from GitHub instead of bundling in npm package

## 0.1.3

### Patch Changes

- [`b59a220`](https://github.com/vobase/vobase/commit/b59a220916a9fb49c610a935342efaea55cb0708) Thanks [@mdluo](https://github.com/mdluo)! - fix: correct package.json path resolution in init command

## 0.1.2

### Patch Changes

- [`e78d5f0`](https://github.com/vobase/vobase/commit/e78d5f03799aeb49370001919334f21fa63dc374) Thanks [@mdluo](https://github.com/mdluo)! - fix: resolve workspace:\* dependency to actual version during npm publish

## 0.1.1

### Patch Changes

- Add changesets and GitHub Actions for automated npm publishing. Fix manifest path in add-skill test.

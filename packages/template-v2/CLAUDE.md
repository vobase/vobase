# Vobase Project

Agent-native helpdesk scaffold. Bun + Hono + Drizzle + Postgres; React + TanStack + shadcn. `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` run the agent; `@vobase/core` is the shared runtime contract.

Core identity: **AI agents need a codebase they can understand.** Every convention below exists to make the next feature one folder to read, one pattern to copy, one seam to change.

## Layout

Backend lives at three top-level seams; frontend at one. No nested package boundaries within the template.

- `modules/<name>/` — every business capability. Owns its backend (`module.ts`, `schema.ts`, `state.ts`, `service/`, `handlers/`, `jobs.ts`, `agent.ts`, `cli.ts`, `web.ts`, `seed.ts`) AND its frontend (`pages/`, `components/`, `hooks/`). One folder per feature is the readability rule.
- `auth/` — better-auth setup, plugins, middleware, transactional emails. Consumed by `runtime/bootstrap.ts` and threaded into modules via `ctx.auth`.
- `runtime/` — backend plumbing:
    - `runtime/index.ts` — cross-module type primitives (`ScopedDb`, `RealtimeService`, `ModuleDef`, `ModuleInitCtx` with `auth: AuthHandle`, `applyTransition`, per-domain `pgSchema` instances). Imported as `~/runtime` from anywhere in the backend.
    - `runtime/bootstrap.ts` — boot orchestration: builds realtime, jobs, auth, calls `bootModules` from `@vobase/core`, registers the four wake-handler jobs (inbound, supervisor, operator-thread, heartbeat-emitter), mounts the SSE route, returns the Hono app. Exported as `createApp(db, sql)`.
    - `runtime/modules.ts` — the static modules list (init order is the array order, then re-sorted by each module's `requires`).
    - `runtime/channel-events.ts` — `ChannelInbound/OutboundEvent` zod schemas + `OUTBOUND_TOOL_NAMES`. Lives at runtime because three modules (messaging, channels, agents) depend on the same wire shape.
- `main.ts` — ~10-line entry at root: connect db, call `createApp`, `Bun.serve`. Stays at root because the Dockerfile points here.
- `src/` — frontend shell only (shadcn / ai-elements / DiceUI primitives, app layout, generic hooks, route registry, typed RPC clients in `src/lib/api-client.ts`). Module-specific UI lives inside the owning module — never `src/features/<m>/` or `src/components/<m>/`.
- `tests/` — e2e (real Postgres) + smoke (manual against dev server). Unit tests colocate next to source as sibling `*.test.ts` — there are no `__tests__/` directories.

The `src/` boundary is enforced by `check:bundle` — putting pg/pg-boss/pi-agent-core under the Vite-resolved tree breaks the frontend build. The script bans `src/**` imports of `@modules/agents/wake/*`, `@modules/agents/workspace/*`, and `~/runtime`.

**Module-root files are backend.** Frontend code lives only in `pages/`, `components/`, `hooks/`. Prevents collisions like a frontend zustand store named `state.ts` shadowing the backend state machine.

## Path aliases

- `@modules/*` — backend + frontend within `modules/<name>/`
- `@auth` / `@auth/*` — `auth/index.ts` + everything under `auth/`
- `~/*` — template root (`~/runtime` resolves to `runtime/index.ts`; `~/runtime/bootstrap`, `~/runtime/modules`)
- `@/*` — frontend `src/`
- `@vobase/core` — shared runtime contract; agents never read `node_modules`

## Quality rules

Non-negotiable because tests and CI enforce them:

- Drizzle for queries, Zod on every handler input via `@hono/zod-validator`, Hono typed RPC on the client (`src/lib/api-client.ts` exports one client per module), TanStack Query never raw `fetch`. Enforced by `.biome/plugins/no-raw-fetch.grit` over `src/**`, `modules/**/pages/**`, `modules/**/components/**`, `modules/**/hooks/**` — only carve-outs are anonymous-session bootstrap and dev-only HMAC simulators (each carries an inline `// biome-ignore lint/plugin/no-raw-fetch: <reason>`).
- No `any`, no unsafe `as`, no `// @ts-ignore`. Strict mode — escape hatches rot.
- Dates/times render through `<RelativeTimeCard date={...} />`. Use `oklch()` colors. shadcn overrides allowed via the `check:shadcn-overrides` lock-file with a `// shadcn-override-ok: <reason>` comment when intentional.
- Agent/staff identity in UI goes through `usePrincipalDirectory()` and `PrincipalAvatar`. Never render a raw agent id or user id — purple robot = agent, blue person = staff is shared across assignees, notes, mentions, activity events.
- Services fire `pg_notify` after commit; `use-realtime-invalidation.ts` maps the `table` field to the first element of a TanStack `queryKey`. No WebSocket, no custom push.
- Prefer Bun native APIs (`Bun.file`, `Bun.write`, `Bun.Glob`, `$`). `require()` is banned. Dynamic `import()` is reserved for heavy optional deps and test mocking; local imports are static.

## Modules

Ten modules ship in `runtime/modules.ts`, init order:

`settings → contacts → team → drive → messaging → agents → schedules → channels → changes → system`

(`bootModules` topologically re-sorts by each module's `requires`, but the array remains the dependency-friendly declaration.)

- **`settings`** — notification prefs, per-user UI state.
- **`contacts`** — customer records + `contacts.memory` (per-customer markdown blob surfaced under `/contacts/<id>/MEMORY.md`).
- **`team`** — staff directory + arbitrary attribute definitions (Slack handle, on-call rota, etc.). Owns the staff-side of the principal directory.
- **`drive`** — virtual filesystem. Real on-disk files plus virtual overlays from other modules (e.g. `/contacts/<id>/profile.md` materialised from `contacts.contacts`). Other modules register overlays via `service/overlays.ts`.
- **`messaging`** — conversations, messages, internal notes, pending approvals, conversation state machine, supervisor fan-out producer. Owns `conversation_events` writes (enforced by `check:shape`).
- **`agents`** — agent definitions, learned skills, staff memory, scores, threads, schedules, the wake harness (`wake/`), the workspace primitives (`workspace/`), tool catalogues (`tools/`).
- **`schedules`** — `agent_schedules` + the cron-tick job that synthesises `HeartbeatTrigger` events for the agents pipeline.
- **`channels`** — umbrella module aggregating channel adapters under `adapters/`. Owns `channel_instances`, the generic webhook router, and outbound dispatch.
- **`changes`** — generic propose / decide / apply / history pipeline. Resources opt in by registering a materializer for `(resourceModule, resourceType)`. Only `changes/service/proposals.ts` may write `change_proposals` / `change_history` (enforced by `check:shape`).
- **`system`** — ops dashboard, the system service catalogue, dev-side helpers.

Each module under `modules/<name>/` contributes a `ModuleDef` from `module.ts`, an aggregator for sibling files: `agent.ts` (agentsMd contributors, materializers, listeners, etc.), `cli.ts` (verb registrations), `web.ts` (Hono routes), `jobs.ts` (pg-boss handlers + queue-name constants), plus `schema.ts`, `state.ts`, `service/`, `handlers/`, `seed.ts`. Frontend siblings are `pages/`, `components/`, `hooks/`. `module.ts` itself contains zero inline tool/listener/materializer literals — `check:shape` enforces this so the aggregator stays grep-able.

`ModuleInitCtx` (from `~/runtime`) carries `{ db, realtime, jobs, scheduler, auth, cli }`. Modules read `ctx.auth` directly in `init` — the old `installXAuth` post-boot patcher is gone. Auth construction happens in `bootstrap.ts` BEFORE `bootModules`, so modules can rely on `ctx.auth` being live during `init`. Same for `ctx.cli` — the `CliVerbRegistry` is constructed before bootModules so verbs register synchronously during init.

Cross-module callers import directly from `@modules/<name>/service/*` — no port shim, no registry lookup, no dynamic dispatch. If the import won't type-check, the architecture is wrong.

### Adapter folder convention

Modules that aggregate multiple pluggable implementations behind one capability follow the umbrella + adapters layout. `modules/<umbrella>/` owns the cross-cutting spine (schema, registry, generic dispatchers, admin index page); each implementation lives at `modules/<umbrella>/adapters/<name>/` with the same `handlers/`, `service/`, optional `pages/`/`components/` shape as a top-level module. The umbrella's `module.ts` is the single registration point — `runtime/modules.ts` lists the umbrella, never the adapters.

`modules/channels/` is the canonical example: schema (`channel_instances`), `service/registry.ts` (name → adapter factory), generic webhook router, generic outbound dispatcher, and `pages/index.tsx`. `adapters/web/` and `adapters/whatsapp/` register their `ChannelAdapter` factories during `init`.

**One write path.** Every mutation happens inside that module's `service/` layer, inside a transaction that also appends to `conversation_events` when the change is conversation-scoped. Handlers, jobs, and tools never touch tables directly. Why: the dual-write problem (mutate + emit event in two places) is the single largest source of inconsistency bugs in helpdesk systems.

For the `messages` and `conversation_events` tables specifically, the rule is structurally enforced by `check:shape`: only `modules/messaging/service/**` may `.insert/update/delete()` them. Cross-module callers route through the typed `appendJournalEvent` wrapper exported from `@modules/messaging/service/journal` — it constrains the event to the `AgentEvent` discriminated union and auto-extracts non-reserved fields into the `payload` JSONB column.

For mutations that staff or agents should review (or that need a tamper-evident edit history), wire the resource into the generic `modules/changes/` pipeline by registering a materializer for `(resourceModule, resourceType)`. The four-file recipe — materializer, registration in `module.ts:init`, propose-change CLI verb, `recordChange` in CRUD handlers — is documented in `.claude/skills/auditable-resource/SKILL.md`. Canonical example is `modules/contacts/`.

## Data conventions

- Money is INTEGER cents.
- Timestamps are `timestamp(..., { withTimezone: true }).defaultNow()`. UTC always; render in the user's tz at the edge.
- Status columns are TEXT with CHECK constraints; transitions live in `state.ts` so the state machine is grep-able.
- IDs use `nanoidPrimaryKey()` — 8 chars, lowercase alphanumeric.
- No cross-module `.references()`. Modules evolve independently; a foreign key across the boundary is a coupling commitment you will regret.
- Gap-free business numbers (INV-0001) via `nextSequence(tx, prefix)`.

## Agent harness

The agents module is the heart of the template. The wake/ subfolder is what runs an agent end-to-end.

### Two lanes, four entry points, one harness

Every wake belongs to one of two lanes:

- **Conversation lane** (`build-config/conversation.ts`) — bound to a specific `(contactId, channelInstanceId, conversationId)` triple. Triggers: `inbound_message`, `supervisor`, `approval_resumed`, `scheduled_followup`, `manual`. Customer-facing tools are wired in by default.
- **Standalone lane** (`build-config/standalone.ts`) — operator threads + heartbeat-driven schedules. Triggers: `operator_thread`, `heartbeat`. No conversation context, no customer-facing tools.

Four wake-handler entry points sit at `wake/`, each registering one pg-boss job consumer in `runtime/bootstrap.ts`:

- `handler.ts` → `channels:inbound-to-wake` (conversation lane, inbound customer message)
- `supervisor-handler.ts` → `messaging:supervisor-to-wake` (conversation lane, staff posted an internal note)
- `operator-thread-handler.ts` → `agents:operator-thread-to-wake` (standalone lane, staff posted in an operator thread)
- `heartbeat.ts` → emitter callback for `schedules` cron-tick (standalone lane, schedule fired)

All four parse their payload, gate by agent existence, look up the agent definition, call the appropriate `buildWakeConfig` / `buildStandaloneWakeConfig`, and hand the config to `createHarness` from `@vobase/core`. The harness drives turns through `pi-agent-core`'s stateful `Agent`, translates pi's event stream into our `AgentEvent` contract, dispatches tools through the mutator chain, and fans events to the observer bus.

### Trigger spec registry

`wake/trigger.ts` is a pure registry: each `WakeTriggerKind` → `{ lane, tools, logPrefix, render }`. Both wake builders consult it via `resolveTriggerSpec(triggerKind)`. Every field is a deterministic function of `(triggerKind, payload, refs)` — no DB reads, no clock — so the `systemHash` derived downstream is byte-stable. Adding a new trigger is a registry entry, not parallel changes across two builders.

The `render` function emits the wake-reason cue prepended to the first user-turn message. **Render text is a thin "what just happened" cue, not a behavioural manual.** Persistent rules belong in `agentDefinitions.instructions` (the agent's prompt) or in skill files under `/agents/<id>/skills/`. Per-wake details live in render; reusable playbooks live in instructions.

### Build-config (per-wake assembly)

`build-config/` is split into two flavours plus shared helpers:

- `base.ts` — shared `BaseWakeDeps`, idle-resumption constant, sse listener, journal adapter, materializer helpers, hook composer, staff-id resolver.
- `conversation.ts` — conv-lane assembly: workspace creation, materializer composition (drive/contacts/messaging/team/agents), frozen prompt, dirty tracker, listener wiring, message history, idle resumption, **supervisor classifier wiring + tool filter**.
- `standalone.ts` — standalone-lane assembly: operator-thread side-load + heartbeat side-load + the standalone tool catalogue.
- `index.ts` — barrel.

The conversation builder is the place that calls `classifySupervisorTrigger` (from messaging) and decides whether to strip customer-facing tools. The trigger registry consumes the resulting `supervisorKind` via `RenderRefs` so render text and tool filter agree.

### Tool catalogue

`tools/conversation/` (audience: customer-visible side-effects) — `reply`, `send_card`, `send_file`, `book_slot` (all `audience: 'customer'`), plus `add_note` (no audience tag). The coaching tool filter (`t.audience !== 'customer'`) keeps `add_note` available so the agent can leave an acknowledgement breadcrumb on the conversation timeline even when customer-facing tools are stripped.

`tools/standalone/` — `add_note`, `create_schedule`, `pause_schedule`, `update_contact`, `propose_outreach`, `summarize_inbox`, `draft_email_to_review`. Operator-side catalogue.

`tools/shared/define-tool.ts` — `defineAgentTool` helper that collapses validation/error-mapping boilerplate. `audience` defaults to undefined (internal); set `'customer'` for tools that produce customer-visible side-effects.

### Supervisor fan-out + coaching classifier

When staff posts an internal note, `messaging/service/notes.ts::addNote` post-commit fan-out enqueues one supervisor wake per "interested agent" — the conversation assignee (always) plus one peer wake per @-mentioned agent that isn't the assignee. **Agent-authored notes never trigger fan-out** (HARD ping-pong filter at `notes.ts:114` — `input.author.kind !== 'agent'`).

The supervisor wake then asks `messaging/service/notes.ts::classifySupervisorTrigger` to decide:
- `coaching` (default) — staff is teaching, not asking. Conversation builder strips customer-facing tools so the agent can't accidentally re-message the customer.
- `ask_staff_answer` — the prior note in the same conversation was an agent-authored question; this note is the answer. Customer-facing tools stay enabled so the agent can relay the answer.

### Non-obvious invariants

*Frozen snapshot.* System prompt is computed once at `agent_start`; `systemHash` must be identical across every turn of the wake. Mid-wake writes (memory, drive proposals, file ops) persist immediately but only surface in the NEXT turn's side-load. Two reasons: the provider's prefix cache is byte-keyed, and the agent must not race its own writes.

*Abort/steer between turns, never inside.* Customer messages append to `SteerQueue` and drain after `tool_execution_end`. Supervisor notes and approval-resumed triggers hard-abort and re-wake — staff intervention outranks the agent's in-flight plan. Cross-conversation wakes never block each other.

*Three-layer byte budget for tool stdout.* 4KB inline preview → 100KB spill to `/tmp/tool-<callId>.txt` → 200KB turn-aggregate ceiling. Read-only re-reads of spill files are exempt.

*Wake event order.* `agent_start → turn_start → llm_call → message_start → message_update* → message_end → (tool_execution_start → tool_execution_end)* → turn_end → … → agent_end`. Filter `message_update` when asserting sequences.

### LLM provider

`wake/llm-provider.ts` is the single seam: Bifrost when `BIFROST_API_KEY` + `BIFROST_URL` are set, direct OpenAI/Anthropic/Google otherwise. `wake/models.ts` carries the model alias map (`gpt_standard`, `claude_sonnet`, `gemini_pro`, etc.). Never hardcode a provider-prefixed model id at a call site.

## Memory model

Three scopes, all written by the agent inside its wake via direct file writes (`echo "- ..." >> /…/MEMORY.md`). The workspace-sync observer flushes the file body to the owning persistence layer at turn end.

- `agent` ↔ `agent_definitions.working_memory` (one row per agent), surfaced as `/agents/<id>/MEMORY.md`. Self-knowledge, policy reminders, "always do X" rules.
- `contact` ↔ `contacts.memory` surfaced as `/contacts/<id>/MEMORY.md` (one row per contact). Per-customer facts, history, preferences.
- `staff` ↔ `agent_staff_memory.memory` (per `(agent, staff)` blob), surfaced as `/staff/<staffId>/MEMORY.md` inside the agent's workspace. What an agent has learned about a specific teammate.

Heuristic for picking the file when capturing a lesson: if the lesson contains a contact's name or refers to "this customer", append to `/contacts/<id>/MEMORY.md`. If it starts with "always" / "never" / "from now on", append to `/agents/<your-id>/MEMORY.md`. Per-staff facts go to `/staff/<staffId>/MEMORY.md`.

The drive's `filesService.readPath/writePath` primitive strips the virtual sentinel header on write for `agent` + `contact`; `staff` goes straight through `staff-memory` because it isn't surfaced under `/drive/**`. Outside a wake, `agent_staff_memory` is writable only via Drizzle Studio.

## Testing

Docker Postgres on port 5433 is required for every integration test. `docker compose up -d` before `bun run test`. `connectTestDb()` reads `DATABASE_URL` from `.env`; helpers never start/stop Docker themselves.

Tests never hit a real LLM. Pass `streamFn: stubStreamFn([...])` to `bootWake` (or `mockStreamFn` to `bootWakeIntegration`) with inline `AssistantMessageEvent[]` scripts — one array per LLM call. Missing terminal `done`/`error` is auto-synthesised. No JSONL fixtures, no recorded-provider files. Without `OPENAI_API_KEY` / `BIFROST_*`, `resolveApiKey()` returns `undefined`, pi-ai skips the Authorization header, and the stub short-circuits before any HTTP call fires.

E2E tests live in `tests/e2e/`. Smoke scripts (run manually against a live dev server with real keys) live in `tests/smoke/`. Shared scaffolding in `tests/helpers/`: `test-db.ts` (`connectTestDb`, `resetAndSeedDb` with cross-process file lock for parallel-worker safety), `test-harness.ts` (`buildIntegrationPorts`, `bootWakeIntegration`), `stub-stream.ts`, `simulated-channel-web.ts`, `assert-event-sequence.ts`, `capture-side-load-hashes.ts`, `assert-learning-flow.ts`. Unit tests colocate next to source.

Anti-patterns: don't mock the database (past migration / CHECK / pg_notify bugs all hid behind mocks); don't introduce JSONL recorded-provider fixtures; don't add narrative Phase/Lane comments to test files; don't write SSR-snapshot tests that diff `renderToString` output.

```ts
beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  ports = await buildIntegrationPorts(db)
})

const res = await bootWakeIntegration(ports, {
  organizationId, agentId, contactId, conversationId,
  mockStreamFn: stubStreamFn([[
    { type: 'done', reason: 'stop', message: { role: 'assistant', content: 'hi', stopReason: 'stop' } },
  ]]),
}, db)

const types = res.capturedEvents.map(e => e.type).filter(t => t !== 'message_update')
expect(types).toEqual(['agent_start', 'turn_start', 'llm_call', 'message_start', 'message_end', 'turn_end', 'agent_end'])
```

E2E tests that bypass module init must install the CLI registry themselves: `setCliRegistry(new CliVerbRegistry())` in `beforeAll`, `__resetCliRegistryForTests()` in `afterAll`. The agents module installs it during `init`; tests calling `buildWakeConfig` / `buildStandaloneWakeConfig` directly skip that path.

## Design tokens

OKLCH with two palettes (`:root` + `.dark`). Never write custom components for things shadcn / ai-elements / DiceUI already provide (empty states, stat cards, status badges, avatar groups, date displays, etc.) — install via `bunx shadcn@latest add <c>`, `bunx --bun ai-elements@latest add <c>`, or `bunx shadcn@latest add "https://diceui.com/r/<c>.json"`.

## What `@vobase/core` gives you

Imported as `import { ... } from '@vobase/core'` so you never read `node_modules`:
- types: `AgentTool`, `ToolContext`, `ToolResult`, `AgentEvent`, `HarnessEvent`, `WakeScope`, `ChannelAdapter`, `SendResult`, `SideLoadContributor`, `WorkspaceMaterializer`, `DirtyTracker`, `HarnessLogger`, `HarnessPlatformHint`, `ClassifiedErrorReason`, `MaterializerCtx`, `OnEventListener`, `ActiveWakesStore`, `ModuleDef` (re-narrowed in `~/runtime`), `ModuleInitCtx` (re-narrowed in `~/runtime`), `AgentContributions`, `WakeRuntime`
- tables: `auditLog`, `recordAudits`, `sequences`, `storageObjects`, `channelsLog`, `channelsTemplates`, `integrationsTable`, `authUser`, `authSession`, `authAccount`, `authApikey`, `authOrganization`, `authMember`, `agentMessages`, `threads`, `conversationEvents`
- helpers: `nanoidPrimaryKey`, `nextSequence`, `trackChanges`, `createHttpClient`, `buildReadOnlyConfig`, `signHmac`, `verifyHmacSignature`, `setPlatformRefresh`, `getPlatformRefresh`, `bootModules`, `journalAppend`, `journalGetLatestTurnIndex`, `journalGetLastWakeTail`, `createIdleResumptionContributor`, `createHarness`, `defineCliVerb`, `CliVerbRegistry`
- errors: `notFound`, `unauthorized`, `forbidden`, `conflict`, `validation`, `dbBusy`

## CLI

Tenants surface a verb catalog at `GET /api/cli/verbs`; the standalone binary at `packages/cli/bin/vobase.ts` walks the catalog and resolves verbs by longest-prefix match. Modules register verbs at `init` via `ctx.cli.register(defineCliVerb({...}))` (or `ctx.cli.registerAll([...])`). Bodies are pure with respect to transport — the same body runs in-process for the agent's bash sandbox and over HTTP-RPC for the binary.

Flags like `--limit=10` are coerced to the JSON-Schema-declared types (`number`, `boolean`, comma-separated arrays) by the resolver before validation, so verb schemas can use strict `z.number()` / `z.boolean()` without `z.coerce.*`. Set `formatHint: 'table:cols=...' | 'json' | 'lines:field=path'` on each verb so the CLI's generic renderer produces useful output. `--json` always overrides the hint.

Auth is API-key bearer with a browser device-grant flow for first-time login (`vobase auth login --url=https://acme.vobase.app`). Headless setups pass `--token=<key>` directly. Configs live at `~/.vobase/<config>.json` with the catalog cache next to them at `~/.vobase/<config>.cache.json`.

## Defaults pattern

Each module that ships starter content places it under `modules/<m>/defaults/`:

- `*.skill.md` — markdown-frontmatter skill bodies. `vobase install --defaults` copies into `modules/<m>/skills/<name>.md` (skip if present; re-apply with `--upgrade`).
- `*.agent.yaml` — agent-definition YAML with `{ organizationId, name, model?, instructions?, workingMemory?, enabled? }`. Inserts a row keyed on `name` (skip if a row with that name already exists in the org).
- `*.schedule.yaml` — schedule YAML with `{ organizationId, agentId, slug, cron, timezone? }`. Inserts a row keyed on `(organizationId, agentId, slug)`.

The verb is **opt-in** — boot does not auto-run defaults. `bun create vobase` runs it as the last provisioning step (with a `--no-defaults` opt-out). Idempotent under `--defaults`; `--upgrade` re-applies file content over file-origin rows.

## Commands

- `docker compose up -d` — Postgres (pgvector/pg17, :5433)
- `bun run dev` — server :3001 + vite :5173; `dev:server` / `dev:web` run one half
- `bun run build` — vite production build
- `bun run typecheck` / `bun run lint` — must be 0 errors
- `bun run test` — full suite (CI entry); `test:e2e` and `test:smoke` auto-discover everything in `tests/e2e` / `tests/smoke`; `bun test <path>` for a single file
- `bun run check` — runs every `check:*` (`shape`, `bundle`, `no-auto-nav-tabs`, `shadcn-overrides`). `check:shape` enforces module-root invariants: only `modules/messaging/service/**` writes `messages` / `conversation_events`; only `modules/changes/service/proposals.ts` writes `change_proposals` / `change_history`; `module.ts` may not contain inline `tools`/`listeners`/`materializers`/`commands`/`sideLoad` literals.
- `bun run db:reset` — nuke + push + seed; individual: `db:push`, `db:generate`, `db:migrate`, `db:nuke`, `db:seed`, `db:studio`

## Dev auth + deploy

Auth is email OTP via better-auth. Dev-only `POST /api/auth/dev-login` (`{ email, name? }`) bypasses OTP — used by seed, e2e, and agent-browser automation. Not available in production.

Dockerfile + `railway.json` included. Set `DATABASE_URL` for managed Postgres, `BIFROST_API_KEY` + `BIFROST_URL` (or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) for the LLM, `META_WA_*` to enable WhatsApp, `R2_*` to switch storage off local disk.

# Vobase Project

Agent-native helpdesk scaffold. Bun + Hono + Drizzle + Postgres; React + TanStack + shadcn. `pi-agent-core` + `pi-ai` run agent; `@vobase/core` shared runtime contract.

Core identity: **AI agents need codebase they understand.** One folder per feature, one pattern copy, one seam change.

## Layout

- `modules/<name>/` — backend (`module.ts`, `schema.ts`, `state.ts`, `service/`, `handlers/`, `jobs.ts`, `agent.ts`, `cli.ts`, `web.ts`, `seed.ts`, `tools/`, `verbs/`) + frontend (`pages/`, `components/`, `hooks/`).
- `wake/` — agent harness, top-level seam (lifted out `modules/agents/` so any module declare agent surfaces no circular imports). Triggers, lane builders, frozen prompt, observers, workspace composition.
- `auth/` — better-auth + plugins; threaded into modules via `ctx.auth`.
- `runtime/` — `index.ts` (cross-module primitives + template-narrowed `ModuleDef`/`ModuleInitCtx`), `bootstrap.ts` (`createApp`), `modules.ts` (static list), `channel-events.ts` (shared wire schemas).
- `main.ts` — ~10-line `Bun.serve` entry.
- `src/` — frontend shell only. Module UI lives in module — never `src/features/<m>/`.
- `tests/` — `e2e/` (real Postgres), `smoke/` (live server, real LLM key). Unit tests beside source `*.test.ts`; no `__tests__/`.

`check:bundle` bans `src/**` imports of `~/wake/*` and `~/runtime`. Module-root files backend; frontend only `pages/`/`components/`/`hooks/`.

## Path aliases

`@modules/*` (backend+frontend), `@auth`/`@auth/*`, `~/*` (template root; `~/runtime`, `~/wake`), `@/*` (frontend `src/`), `@vobase/core`.

## Quality rules (enforced by CI)

- Drizzle queries; Zod every handler input; Hono typed RPC client (`src/lib/api-client.ts`); TanStack Query, never raw `fetch` (biome `no-raw-fetch.grit` over `src/`, `pages/`, `components/`, `hooks/`).
- No `any`, no unsafe `as`, no `// @ts-ignore`.
- Dates render via `<RelativeTimeCard>`. OKLCH colors. shadcn overrides need `// shadcn-override-ok: <reason>`.
- Agent/staff identity in UI through `usePrincipalDirectory()` + `<PrincipalAvatar>` (purple robot = agent, blue person = staff). Never render raw ids.
- Services `pg_notify` after commit; `use-realtime-invalidation.ts` maps `table` → first element TanStack `queryKey`. No WebSocket.
- Bun-native APIs (`Bun.file`/`write`/`Glob`/`$`). `require()` banned. Dynamic `import()` only heavy optional deps + test mocking.

## Modules

Init order in `runtime/modules.ts` (re-sorted by `requires`):
`settings → contacts → team → drive → messaging → agents → schedules → channels → changes → system`

- **settings** — notification prefs, per-user UI state.
- **contacts** — customer records + `contacts.memory` (`/contacts/<id>/MEMORY.md`).
- **team** — staff directory + attributes; staff side principal directory.
- **drive** — virtual filesystem; other modules register overlays via `service/overlays.ts`.
- **messaging** — conversations, messages, internal notes, pending approvals, state machine, supervisor fan-out producer. Sole writer `conversation_events` (`check:shape`).
- **agents** — definitions, learned skills, staff memory, scores, threads, agent-side schedules, runtime `CliVerbRegistry` singleton, agent self-state surface (`/agents/<id>/AGENTS.md` + `/MEMORY.md`). Imports nothing from messaging/contacts.
- **schedules** — `agent_schedules` + cron-tick emits `HeartbeatTrigger`.
- **channels** — umbrella aggregating `adapters/<name>/`. Owns `channel_instances`, generic webhook router, outbound dispatch.
- **changes** — generic propose/decide/apply/history. Resources opt in by registering materializer for `(resourceModule, resourceType)`. Sole writer `change_proposals`/`change_history` (`check:shape`).
- **system** — ops dashboard, dev helpers.

Each `module.ts` thin aggregator over sibling files:

- `agent.ts` — `agentsMd` (AGENTS.md fragments), `materializers` (`WorkspaceMaterializerFactory<WakeContext>` returning `WorkspaceMaterializer[]`), `roHints` (chained by `chainRoHints`), `tools` (`AgentTool[]` with `audience: 'customer'|'internal'`, `lane: 'conversation'|'standalone'|'both'`, optional `prompt` for AGENTS.md guidance).
- `tools/<name>.ts` — `defineAgentTool` from `@vobase/core`. Colocated with service owning side-effect.
- `verbs/<name>.ts` — `defineCliVerb` registrations.
- `cli.ts` — barrel exporting `<module>Verbs` for `init`'s `ctx.cli.registerAll(...)`.

`module.ts` no inline `tools`/`listeners`/`materializers`/`commands`/`sideLoad` literals (`check:shape`). `ctx` in `init` = `{ db, realtime, jobs, scheduler, auth, cli }` — auth + cli built before `bootModules` so modules use synchronously. Cross-module callers `import` from `@modules/<name>/service/*` directly; no port shim.

**Adapter umbrella convention.** Modules with multiple pluggable backends use `modules/<umbrella>/adapters/<name>/`, mirroring top-level module shape. `runtime/modules.ts` lists umbrella, never adapters. Canonical: `modules/channels/`.

**One write path.** Every mutation through that module's `service/` layer in transaction that also appends `conversation_events` when conversation-scoped. `check:shape` enforces for `messages`/`conversation_events` (only `messaging/service/**`) and `change_proposals`/`change_history` (only `changes/service/proposals.ts`). Cross-module journal writes route via `appendJournalEvent` from `@modules/messaging/service/journal`.

For staff- or agent-reviewed mutations, wire resource into `modules/changes/`. Recipe: `.claude/skills/auditable-resource/SKILL.md`; canonical example `modules/contacts/`.

## Data conventions

- Money INTEGER cents.
- Timestamps `timestamp(..., { withTimezone: true }).defaultNow()`; UTC, render user tz at edge.
- Status columns TEXT + CHECK; transitions in `state.ts`.
- IDs via `nanoidPrimaryKey()` (8 chars, lowercase alnum).
- No cross-module `.references()`; no FK across module boundaries.
- Gap-free business numbers via `nextSequence(tx, prefix)`.

## Agent harness

`bootModules` produces `AgentContributions<WakeContext>` (union every module's `agent` slot). Wake builders aggregate, lane-filter, assemble config for `createHarness`.

**Naming.** Two context types, one informal noun. No new ones.
- `AgentContributions<WakeContext>` — boot-time aggregate (every module's `agent` slot merged by `bootModules`). Singleton per process.
- `WakeContext` (`wake/context.ts`) — per-wake bag passed to each `WorkspaceMaterializerFactory<WakeContext>`. Carries identity (`organizationId`, `agentId`, `conversationId`, optional `contactId`/`channelInstanceId`), handles (`drive`, `authLookup`, `staffIds`, `agentDefinition`), lane-filtered slices (`tools`, `agentsMdContributors`), wake classification (`lane`, `triggerKind`, optional `supervisorKind`, `audienceTier`).
- "Agent harness" — informal name for `wake/` folder + runtime machinery; **not** context type. No `HarnessContext` anywhere.

**Lanes.**
- Conversation (`wake/conversation.ts → conversationWakeConfig`) — bound to `(contactId, channelInstanceId, conversationId)`. Triggers: `inbound_message`, `supervisor`, `approval_resumed`, `scheduled_followup`, `manual`.
- Standalone (`wake/standalone.ts → standaloneWakeConfig`) — operator threads + heartbeats. Triggers: `operator_thread`, `heartbeat`. Tools with `lane === 'conversation'` dropped.

**Audience tiers.** Three-tier monotonic trust model: `'admin' | 'staff' | 'contact'` (`AudienceTier` from `@vobase/core`). Wake's `audienceTier` derived from `(lane, triggerKind)` by lane builders:

| `(lane, triggerKind)` | `audienceTier` |
|---|---|
| `conversation + inbound_message` | `'contact'` (least trust — customer-driven) |
| `conversation + supervisor / approval_resumed / scheduled_followup / manual` | `'staff'` |
| `standalone + operator_thread / heartbeat` | `'staff'` |
| `vobase` CLI binary with admin API key (outside harness) | `'admin'` |

Agent's AGENTS.md `## Commands` block + in-bash `vobase --help` filter via `isVerbVisible(verb.audience, wake.audienceTier)` — verb visible iff `verb.audience ≤ wake.audienceTier` (admin ≥ staff ≥ contact). When registering verb with `defineCliVerb`, set `audience`:
- `'contact'` — every wake (and human) sees it. Read-mostly verbs not redundant with VFS (`team list`, `team get`, `conv reassign`, `drive propose`).
- `'staff'` — staff-initiated wakes + admin only. Mutating verbs scoped to thread/inbox (`messaging close`, `messaging show`, `agents show`).
- `'admin'` — tenant-config / dev-tooling verbs run by operator from actual CLI (`install`, `drive cat`, anything in `system/`). Default when omitted.

NB: tool-side `audience: 'customer' | 'internal'` field on `defineAgentTool` is **different concept** — gates whether tool dropped on supervisor-**coaching** wakes (`audience: 'customer'` tools stripped so agent can't reply to customer mid-correction). Same word, different filter; don't conflate.

**Adding agent surfaces in new module.** Declare any of `tools` / `materializers` / `agentsMd` / `roHints` on `agent.ts` (re-exported by `module.ts`; `check:shape` rejects inline literals). Wake builder filters `tools` by `lane` (and by `audience: 'customer'|'internal'` on supervisor-coaching wakes), invokes each `WorkspaceMaterializerFactory<WakeContext>` with wake's context, chains `roHints` via `chainRoHints`, feeds `agentsMd` fragments into AGENTS.md preamble — no further wiring. Verbs registered via `ctx.cli.register(...)` in `init` (not agent slot); set `audience` per **Audience tiers** table above.

**Entry points** (each pg-boss consumer registered in `runtime/bootstrap.ts`):

| File | Job | Lane |
|---|---|---|
| `wake/inbound.ts` | `channels:inbound-to-wake` | conversation |
| `wake/supervisor.ts` | `messaging:supervisor-to-wake` | conversation |
| `wake/operator-thread.ts` | `agents:operator-thread-to-wake` | standalone |
| `wake/heartbeat.ts` | cron-tick callback for `schedules` | standalone |

Each handler factory takes `(deps, contributions)` at boot. At wake time builder filters `contributions.tools` by lane (and by `audience` on supervisor-coaching wakes), invokes each `materializerFactories[i](wakeContext)`, chains `roHints` via `chainRoHints`, feeds `agentsMdContributors` into agents-module `agentsMaterializerFactory` (runs `generateAgentsMd` with per-module fragments + tool guidance + helpdesk preamble).

**Trigger registry.** `wake/trigger.ts` maps each `WakeTriggerKind → { lane, logPrefix, render }`. Pure: deterministic in `(triggerKind, payload, refs)`, so downstream `systemHash` byte-stable. Tools NOT in registry — adding one is one-line edit in owning module's `agent.ts`. `render` function emits wake-reason cue prepended to first user-turn message; persistent rules belong in `agentDefinitions.instructions` or skill files, not render text.

**Build helpers.** `wake/build-base.ts` (idle-resumption constant, SSE listener, journal adapter, hook composer, staff-id resolver, `INDEX.md` materializer). Conversation builder calls `classifySupervisorTrigger` from `messaging/service/notes` and threads resulting `supervisorKind` into `RenderRefs` so render text and tool filter agree.

**Tools by module:**
- `messaging/tools/` — `reply`, `send_card`, `send_file`, `book_slot` (`audience: 'customer'`, `lane: 'conversation'`); `add_note` (`internal`, `both`); `summarize_inbox`, `draft_email_to_review` (`standalone`).
- `contacts/tools/` — `update_contact`, `propose_outreach`.
- `schedules/tools/` — `create_schedule`, `pause_schedule`.

**Verbs by module:** `messaging/verbs/` (`conv-reassign`), `drive/verbs/` (`drive-propose`), `team/verbs/` (`team-list`, `team-get`), `agents/cli.ts` (`agents list/show/inspect`, `schedules list/...`).

**Supervisor fan-out.** `messaging/service/notes::addNote` post-commit enqueues one supervisor wake per interested agent (assignee + each @-mentioned peer). Agent-authored notes never trigger fan-out (HARD filter at `notes.ts`). `classifySupervisorTrigger` returns `coaching` (default; strips `audience: 'customer'`) or `ask_staff_answer` (staff replying to prior agent question; customer-facing tools stay).

**Invariants.**
- *Frozen snapshot.* System prompt computed once at `agent_start`; `systemHash` identical every turn. Mid-wake writes surface in NEXT turn's side-load (provider prefix cache byte-keyed, agent must not race itself).
- *Abort/steer between turns.* Customer messages append to `SteerQueue` and drain after `tool_execution_end`. Supervisor + approval-resumed hard-abort and re-wake.
- *Tool stdout budget.* 4KB inline → 100KB spill (`/tmp/tool-<callId>.txt`) → 200KB turn ceiling. Re-reads of spills exempt.
- *Wake event order.* `agent_start → turn_start → llm_call → message_start → message_update* → message_end → (tool_execution_start → tool_execution_end)* → turn_end → … → agent_end`. Filter `message_update` when asserting sequences.

**LLM provider.** `wake/llm.ts` single seam — Bifrost when `BIFROST_API_KEY`+`BIFROST_URL` set, else direct OpenAI/Anthropic/Google. Use `createModel(alias)` from `~/wake`; never hardcode provider-prefixed id.

## Memory model

Three scopes, all written by direct file writes inside wake (`echo "- ..." >> /…/MEMORY.md`); workspace-sync observer flushes at turn end.

- **agent** ↔ `agent_definitions.working_memory` → `/agents/<id>/MEMORY.md` (self-knowledge, "always do X").
- **contact** ↔ `contacts.memory` → `/contacts/<id>/MEMORY.md` (per-customer facts).
- **staff** ↔ `agent_staff_memory.memory` → `/staff/<staffId>/MEMORY.md` (per-`(agent, staff)`).

Heuristic when capturing lesson: contains contact name → contact memory; starts always/never/from-now-on → agent memory; per-staff fact → staff memory. `filesService.readPath/writePath` strips virtual sentinel header for agent+contact; staff goes through `staff-memory` (no `/drive/**` mirror; outside wake, only Drizzle Studio).

## Testing

Docker Postgres :5432 required. `docker compose up -d` then `bun run test`. `connectTestDb()` reads `DATABASE_URL`; helpers don't manage Docker.

Tests never hit real LLM. Pass `streamFn: stubStreamFn([...])` to `bootWake` (or `mockStreamFn` to `bootWakeIntegration`) — inline `AssistantMessageEvent[]` per LLM call. Missing terminal `done`/`error` auto-synthesised. Without API key, `resolveApiKey()` returns undefined and pi-ai skips Authorization header.

E2E in `tests/e2e/`. Live smokes in `tests/smoke/` (real LLM, dev server). Helpers: `test-db.ts`, `test-harness.ts`, `stub-stream.ts`, `simulated-channel-web.ts`, `assert-event-sequence.ts`, `capture-side-load-hashes.ts`, `assert-learning-flow.ts`. E2E that bypasses module init must `setCliRegistry(new CliVerbRegistry())` in `beforeAll` and `__resetCliRegistryForTests()` in `afterAll`.

`tests/smoke/smoke-{inbound,supervisor-action,operator-thread,heartbeat}-live.ts` (+ `smoke-all-triggers-live.ts` driver) verify cross-module effects (memory writes, drive proposals, internal-note replies) actually fire. "Agent silently no-ops" failure mode historically caught only at this layer.

Anti-patterns: don't mock database (mocks hide migration / CHECK / pg_notify bugs); no JSONL recorded-provider fixtures; no narrative Phase/Lane comments in tests; no `renderToString` SSR-snapshot tests.

## Design tokens

OKLCH (`:root` + `.dark`). Search shadcn / ai-elements / DiceUI before writing custom: `bunx shadcn@latest add <c>`, `bunx --bun ai-elements@latest add <c>`, `bunx shadcn@latest add "https://diceui.com/r/<c>.json"`.

## CLI

Tenants expose `GET /api/cli/verbs`; `packages/cli/bin/vobase.ts` walks catalog, longest-prefix match. Modules register at `init` via `ctx.cli.register(defineCliVerb({...}))` / `registerAll([...])`. Same body runs in-process (bash sandbox) and over HTTP-RPC (CLI binary).

Each verb declares `audience: 'admin' | 'staff' | 'contact'` (default `'admin'`); AGENTS.md `## Commands` block and bash `--help` filter by `isVerbVisible(verb.audience, wake.audienceTier)`. See **Audience tiers** under Agent harness for which tier each new verb picks.

Argv flags coerce to JSON-Schema types before validation, so verb schemas use strict `z.number()` / `z.boolean()` (no `z.coerce.*`). `formatHint: 'table:cols=...' | 'json' | 'lines:field=path'` per verb; `--json` always overrides.

Auth API-key bearer, browser device-grant for first login (`vobase auth login --url=...`); headless uses `--token=<key>`. Configs at `~/.vobase/<config>.json`, catalog cache `~/.vobase/<config>.cache.json`.

## Defaults

Per-module starter content under `modules/<m>/defaults/`:
- `*.agent.yaml` — `{ organizationId, name, model?, instructions?, workingMemory?, enabled? }`. Insert keyed on `name`.
- `*.schedule.yaml` — `{ organizationId, agentId, slug, cron, timezone? }`. Insert keyed on `(orgId, agentId, slug)`.

Skill bodies (`modules/<m>/skills/*.md`) ship inline; agent reads via drive overlay (`/agents/<id>/skills/`) — no separate seeding.

Opt-in. `bun create vobase` runs `vobase install --defaults` last (with `--no-defaults`); idempotent; `--upgrade` re-applies file content over file-origin rows.

## Commands

- `docker compose up -d` — Postgres pgvector/pg17 :5432
- `bun run dev` — server :3001 + vite :5173 (`dev:server` / `dev:web` for halves)
- `bun run build` / `typecheck` / `lint` — must be 0 errors
- `bun run test` — full suite; `test:e2e` / `test:smoke` auto-discover; `bun test <path>` for one file
- `bun run check` — runs every `check:*` (`shape`, `bundle`, `no-auto-nav-tabs`, `shadcn-overrides`)
- `bun run db:reset` — nuke + push + seed; individual: `db:push`, `db:generate`, `db:migrate`, `db:nuke`, `db:seed`, `db:studio`

## Dev auth + deploy

Email OTP via better-auth. Dev-only `POST /api/auth/dev-login` (`{ email, name? }`) bypasses OTP — used by seed, e2e, agent-browser. Not in production.

Dockerfile + `railway.json`. Set `DATABASE_URL`, `BIFROST_API_KEY`+`BIFROST_URL` (or `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`), `META_WA_*` for WhatsApp, `R2_*` for non-local storage.
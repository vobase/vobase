# Vobase Project

Agent-native helpdesk scaffold. Bun + Hono + Drizzle + Postgres; React + TanStack + shadcn. `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` run the agent; `@vobase/core` is the shared runtime contract.

Core identity: **AI agents need a codebase they can understand.** Every convention below exists to make the next feature one folder to read, one pattern to copy, one seam to change.

## Layout

Backend lives at three top-level seams; frontend at one. No nested package boundaries within the template.

- `modules/<name>/` — every business capability. Owns its backend (`module.ts`, `schema.ts`, `state.ts`, `service/`, `handlers/`, `jobs.ts`, `agent.ts`, `web.ts`, `seed.ts`) AND its frontend (`pages/`, `components/`). One folder per feature is the readability rule.
- `auth/` — better-auth setup, plugins, middleware, and transactional emails. The single auth surface; consumed by `runtime/bootstrap.ts` and threaded into modules via `ctx.auth`.
- `runtime/` — backend plumbing:
    - `runtime/index.ts` — cross-module type primitives (`ScopedDb`, `RealtimeService`, `ModuleDef`, `ModuleInitCtx` with `auth: AuthHandle`, `applyTransition`, per-domain `pgSchema` instances). Imported as `~/runtime` from anywhere in the backend.
    - `runtime/bootstrap.ts` — boot orchestration: builds realtime, jobs, auth, calls `bootModules` from `@vobase/core`, mounts the SSE route, returns the Hono app. Exported as `createApp(db, sql)`.
- `main.ts` — ~10-line entry point at root: connect db, call `createApp`, `Bun.serve`. Stays at root because the Dockerfile points here.
- `src/` — frontend shell only (shadcn / ai-elements / DiceUI primitives, app layout, generic hooks, route registry). Module-specific UI lives inside the owning module — never `src/features/<m>/` or `src/components/<m>/`.
- `tests/` — e2e (real Postgres) + smoke (manual against dev server). Unit tests colocate next to source.

The `src/` boundary is enforced by `check:bundle` — putting pg/pg-boss/pi-agent-core under the Vite-resolved tree breaks the frontend build. The script bans `src/**` imports of `@modules/agents/wake/*`, `@modules/agents/workspace/*`, and `~/runtime`.

## Path aliases

- `@modules/*` — backend + frontend within `modules/<name>/`
- `@auth` / `@auth/*` — `auth/index.ts` + everything under `auth/`
- `~/*` — template root (`~/runtime` resolves to `runtime/index.ts`; `~/runtime/bootstrap`, `~/vobase.config`)
- `@/*` — frontend `src/`
- `@vobase/core` — shared runtime contract; agents never read `node_modules`

## Quality rules

Non-negotiable because tests and CI enforce them:

- Drizzle for queries, Zod on every handler input, Hono typed RPC on the client, TanStack Query never raw `fetch`. The typed seam is what lets agents refactor without reading call sites.
- No `any`, no unsafe `as`, no `// @ts-ignore`. Strict mode — escape hatches rot.
- Dates/times render through `<RelativeTimeCard date={...} />`. The retired `check:tokens` rule used to ban raw `toLocaleString` / hex colors; that's now a cultural convention. Use `<RelativeTimeCard>` (auto-updating, i18n-safe). Use `oklch()` colors. shadcn overrides are allowed — the `check:shadcn-overrides` lock-file lets you opt-in via a `// shadcn-override-ok: <reason>` comment when intentional.
- Agent/staff identity in UI goes through `usePrincipalDirectory()` and `PrincipalAvatar`. Never render a raw agent id or user id — purple robot = agent, blue person = staff is a shared convention across assignees, notes, mentions, activity events.
- Services fire `pg_notify` after commit; `use-realtime-invalidation.ts` maps the `table` field to the first element of a TanStack `queryKey`. No WebSocket, no custom push — one contract is the whole point.
- Prefer Bun native APIs (`Bun.file`, `Bun.write`, `Bun.Glob`, `$`). `require()` is banned. Dynamic `import()` is reserved for heavy optional deps and test mocking; local imports are static.

## Modules

Each module under `modules/<name>/` contributes a `ModuleDef` from `module.ts`, which is an aggregator for sibling files: `agent.ts` (tools, listeners, materializers, commands, sideLoad), `web.ts` (Hono routes), `jobs.ts` (pg-boss handlers), plus `schema.ts`, `state.ts`, `service/`, `handlers/`, `seed.ts`. `module.ts` itself contains zero inline tool/listener/materializer literals — `check:shape` enforces this so the aggregator stays grep-able.

`ModuleInitCtx` (from `~/runtime`) carries `{ db, realtime, jobs, scheduler, auth }`. Modules read `ctx.auth` directly in `init` — the old `installXAuth` post-boot patcher is gone. Auth construction happens in `bootstrap.ts` BEFORE `bootModules`, so modules can rely on `ctx.auth` being live during `init`.

**Init order** `settings → contacts → team → drive → messaging → agents → channel-web → channel-whatsapp → system`, enforced by each module's `requires`. Cross-module callers import directly from `@modules/<name>/service/*` — there is no port shim, no registry lookup, no dynamic dispatch. If the import won't type-check, the architecture is wrong. (Slice 4b identity rule: direct typed cross-module imports.)

**One write path.** Every mutation happens inside that module's `service/` layer, inside a transaction that also appends to `conversation_events`. Handlers, jobs, and tools never touch tables directly. Why: the dual-write problem (mutate + emit event in two places) is the single largest source of inconsistency bugs in helpdesk systems.

For the `messages` and `conversation_events` tables specifically, the rule is structurally enforced by `check:shape`: only `modules/messaging/service/**` may `.insert/update/delete()` them. Cross-module callers (e.g. `agents/service/learning-proposals.ts`) route through the typed `appendJournalEvent` wrapper exported from `@modules/messaging/service/journal` — it constrains the event to the `AgentEvent` discriminated union and auto-extracts non-reserved fields into the `payload` JSONB column.

## Data conventions

- Money is INTEGER cents. Floats have silent rounding; every helpdesk ends up with off-by-one currency bugs if you don't.
- Timestamps are `timestamp(..., { withTimezone: true }).defaultNow()`. UTC always; render in the user's tz at the edge.
- Status columns are TEXT with CHECK constraints; transitions live in `state.ts` so the state machine is grep-able.
- IDs use `nanoidPrimaryKey()` — 8 chars, lowercase alphanumeric. Short enough for URLs, long enough for a 6-module helpdesk.
- No cross-module `.references()`. Modules evolve independently; a foreign key across the boundary is a coupling commitment you will regret.
- Gap-free business numbers (INV-0001) via `nextSequence(tx, prefix)`.

## Agent harness

`bootWake` (in `modules/agents/wake/`) assembles the frozen system prompt once, drives turns through `pi-agent-core`'s stateful `Agent`, translates pi's event stream into our `AgentEvent` contract, dispatches tools through the mutator chain, and fans events to the observer bus. `llm-provider.ts` is the single provider seam: Bifrost when `BIFROST_API_KEY` + `BIFROST_URL` are set, direct OpenAI otherwise.

`wake/handler.ts` is the slim entry — it parses the trigger, gates by agent assignee, looks up the agent definition, and calls `buildWakeConfig` + `createHarness`. `wake/build-config.ts` owns the per-wake parameter assembly: materializer composition, workspace creation, frozen prompt, dirty tracker, listener wiring, idle resumption, message history threading. Cache-stability invariants (frozen-snapshot rule, byte-keyed prefix cache, write-vs-read race avoidance) are documented at the top of `build-config.ts` — splitting it further would fragment them.

The non-obvious invariants that bind everything together:

*Frozen snapshot.* System prompt is computed once at `agent_start`; `systemHash` must be identical across every turn of the wake. Mid-wake writes (memory, drive proposals, file ops) persist immediately but only surface in the NEXT turn's side-load. Two reasons: the provider's prefix cache is byte-keyed, and the agent must not race its own writes.

*Abort/steer between turns, never inside.* Customer messages append to `SteerQueue` and drain after `tool_execution_end`. Supervisor notes and approval-resumed triggers hard-abort and re-wake — staff intervention outranks the agent's in-flight plan. Cross-conversation wakes never block each other.

*Three-layer byte budget for tool stdout.* 4KB inline preview → 100KB spill to `/tmp/tool-<callId>.txt` → 200KB turn-aggregate ceiling. Read-only re-reads of spill files are exempt. Without this, one `cat`-of-a-huge-file destroys the context window.

*Wake event order.* `agent_start → turn_start → llm_call → message_start → message_update* → message_end → (tool_execution_start → tool_execution_end)* → turn_end → … → agent_end`. Filter `message_update` when asserting sequences.

## Testing

Docker Postgres on port 5433 is required for every integration test. `docker compose up -d` before `bun run test`. `connectTestDb()` reads `DATABASE_URL` from `.env`; helpers never start/stop Docker themselves.

Tests never hit a real LLM. Pass `streamFn: stubStreamFn([...])` to `bootWake` (or `mockStreamFn` to `bootWakeIntegration`) with inline `AssistantMessageEvent[]` scripts — one array per LLM call. Missing terminal `done`/`error` is auto-synthesised. No JSONL fixtures, no recorded-provider files — they rot the moment the prompt changes. Without `OPENAI_API_KEY` / `BIFROST_*`, `resolveApiKey()` returns `undefined`, pi-ai skips the Authorization header, and the stub short-circuits before any HTTP call fires.

E2E tests live in `tests/e2e/`. Smoke scripts (run manually against a live dev server) live in `tests/smoke/`. Shared scaffolding in `tests/helpers/`: `test-db.ts` (`connectTestDb`, `resetAndSeedDb`), `test-harness.ts` (`buildIntegrationPorts`, `bootWakeIntegration`), `stub-stream.ts`, `simulated-channel-web.ts` (mimics inbound webhook), `assert-event-sequence.ts` (tolerates `message_update` deltas), `capture-side-load-hashes.ts` (frozen-snapshot invariant), `assert-learning-flow.ts`. Unit tests colocate next to source.

Anti-patterns: don't mock the database (past migration / CHECK / pg_notify bugs all hid behind mocks); don't introduce JSONL recorded-provider fixtures; don't add narrative Phase/Lane comments to test files.

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

## Design tokens

OKLCH with two palettes (`:root` + `.dark`). Never write custom components for things shadcn / ai-elements / DiceUI already provide (empty states, stat cards, status badges, avatar groups, date displays, etc.) — install via `bunx shadcn@latest add <c>`, `bunx --bun ai-elements@latest add <c>`, or `bunx shadcn@latest add "https://diceui.com/r/<c>.json"`.

## What `@vobase/core` gives you

Imported as `import { ... } from '@vobase/core'` so you never read `node_modules`:
- types: `AgentTool`, `ToolContext`, `ToolResult`, `AgentEvent`, `HarnessEvent`, `WakeScope`, `ChannelAdapter`, `SendResult`, `SideLoadContributor`, `WorkspaceMaterializer`, `DirtyTracker`, `HarnessLogger`, `HarnessPlatformHint`, `ClassifiedErrorReason`, `MaterializerCtx`, `OnEventListener`, `ActiveWakesStore`, `ModuleDef` (re-narrowed in `~/runtime`), `ModuleInitCtx` (re-narrowed in `~/runtime`)
- tables: `auditLog`, `recordAudits`, `sequences`, `storageObjects`, `channelsLog`, `channelsTemplates`, `integrationsTable`, `authUser`, `authSession`, `authAccount`, `authApikey`, `authOrganization`, `authMember`, `agentMessages`, `threads`, `conversationEvents`
- helpers: `nanoidPrimaryKey`, `nextSequence`, `trackChanges`, `createHttpClient`, `buildReadOnlyConfig`, `signHmac`, `verifyHmacSignature`, `setPlatformRefresh`, `getPlatformRefresh`, `bootModules`, `journalAppend`, `journalGetLatestTurnIndex`, `journalGetLastWakeTail`
- errors: `notFound`, `unauthorized`, `forbidden`, `conflict`, `validation`, `dbBusy`

## Commands

- `docker compose up -d` — Postgres (pgvector/pg17, :5433)
- `bun run dev` — server :3001 + vite :5173; `dev:server` / `dev:web` run one half
- `bun run build` — vite production build
- `bun run typecheck` / `bun run lint` — must be 0 errors
- `bun run test` — full suite (CI entry point); `test:e2e` and `test:smoke` auto-discover everything in `tests/e2e` / `tests/smoke`; `bun test <path>` for a single file
- `bun run check` — runs every `check:*` (`shape`, `bundle`, `no-auto-nav-tabs`, `shadcn-overrides`)
- `bun run db:reset` — nuke + push + seed; individual: `db:push`, `db:generate`, `db:migrate`, `db:nuke`, `db:seed`, `db:studio`

## Dev auth + deploy

Auth is email OTP via better-auth. Dev-only `POST /api/auth/dev-login` (`{ email, name? }`) bypasses OTP — used by seed, e2e, and agent-browser automation. Not available in production.

Dockerfile + `railway.json` included. Set `DATABASE_URL` for managed Postgres, `BIFROST_API_KEY` + `BIFROST_URL` (or `OPENAI_API_KEY`) for the LLM, `META_WA_*` to enable WhatsApp, `R2_*` to switch storage off local disk.

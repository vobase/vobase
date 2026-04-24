# Vobase Project

Agent-native helpdesk scaffold. Bun + Hono + Drizzle + Postgres; React + TanStack + shadcn. `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` run the agent; `@vobase/core` is the shared runtime contract.

Core identity: **AI agents need a codebase they can understand.** Every convention below exists to make the next feature one folder to read, one pattern to copy, one seam to change.

## Layout

`server/` is the hard Vite-exclusion line — putting pg/pg-boss/pi-agent-core under `src/` forces the browser bundler to resolve native drivers and breaks the build. `src/` is frontend shell only (shadcn/ai-elements/DiceUI primitives, app layout, generic hooks, route registry). Module-specific UI lives inside the owning module, not `src/features/<m>/` or `src/components/<m>/` — see `src/CLAUDE.md` for the rule. `modules/` straddles backend + frontend per domain so a feature is one folder to read, not three. `tests/` holds e2e (real Postgres) and smoke (manual, against dev server); unit tests colocate next to source.

Subfolders own their own invariants via CLAUDE.md — read the nearest one before touching:
- `modules/CLAUDE.md` — module shape, init order, cross-module service imports
- `modules/messaging/CLAUDE.md` — one-write-path, message kinds, approval flow, mentions
- `modules/agents/CLAUDE.md` — journal writer, observer/mutator order, learning flow, wake triggers
- `modules/drive/CLAUDE.md` — scope rules, virtual-field overlay, `BUSINESS.md`, proposals
- `server/harness/CLAUDE.md` — frozen snapshot, wake event order, abort/steer, byte budget
- `server/workspace/CLAUDE.md` — materializers run before side-load, RO enforcement
- `server/transports/CLAUDE.md` — channels as transport-only, HMAC, outbound tool sync
- `server/middlewares/CLAUDE.md` — auth / org scope / audit ordering
- `src/CLAUDE.md` — the "would a second module use this as-is" test

## Quality rules

Non-negotiable because tests and CI enforce them:

- Drizzle for queries, Zod on every handler input, Hono typed RPC on the client, TanStack Query never raw `fetch`. The typed seam is what lets agents refactor without reading call sites.
- No `any`, no unsafe `as`, no `// @ts-ignore`. Strict mode — escape hatches rot.
- Dates/times render through `<RelativeTimeCard date={...} />`. `check:tokens` fails on raw `toLocaleString` / custom formatters in `.tsx`; relative time is i18n-safe and auto-updates.
- Agent/staff identity in UI goes through `usePrincipalDirectory()` and `PrincipalAvatar`. Never render a raw agent id or user id — purple robot = agent, blue person = staff is a shared convention across assignees, notes, mentions, activity events.
- Services fire `pg_notify` after commit; `use-realtime-invalidation.ts` maps the `table` field to the first element of a TanStack `queryKey`. No WebSocket, no custom push — one contract is the whole point.
- Path aliases: `@server/*`, `@modules/*`, `@/*`. `check:bundle` forbids `src/**` from importing `@server/runtime/*` or `@server/harness/*` — that's what keeps Vite honest.
- Prefer Bun native APIs (`Bun.file`, `Bun.write`, `Bun.Glob`, `$`). `require()` is banned. Dynamic `import()` is reserved for heavy optional deps and test mocking; local imports are static.

## Modules

Each module in `modules/<name>/` exports `defineModule({ ... })` from `module.ts`. `check:shape` fails if any of these are missing: `module.ts`, `manifest.ts`, `schema.ts`, `state.ts`, `service/index.ts`, `handlers/index.ts`, `jobs.ts`, `seed.ts`, `README.md`. Handler files cap at 200 raw lines — lift into `service/`. `applyTransition()` lives only in `state.ts` so state changes have one provably-correct place.

**One-write-path.** Every mutation happens inside that module's `service/` layer, inside a transaction that also appends to `conversation_events`. Handlers, jobs, and tools never touch tables directly. Why: the dual-write problem (mutate + emit event in two places) is the single largest source of inconsistency bugs in helpdesk systems. CI-enforced for `messages` / `conversation_events` via `check:shape`; other tables follow the same pattern by convention.

**Init order** `settings → contacts → team → drive → messaging → agents → transports/web → transports/whatsapp`, enforced by each module's `requires`. Cross-module callers import directly from `@modules/<name>/service/*` — there's no port shim, no registry lookup, no dynamic dispatch. If the import won't type-check, the architecture is wrong. Channel adapters *do* ship `port.ts` because `V2ChannelAdapter` has multiple implementations.

## Data conventions

- Money is INTEGER cents. Floats have silent rounding; every helpdesk ends up with off-by-one currency bugs if you don't.
- Timestamps are `timestamp(..., { withTimezone: true }).defaultNow()`. UTC always; render in the user's tz at the edge.
- Status columns are TEXT with CHECK constraints; transitions live in `state.ts` so the state machine is grep-able.
- IDs use `nanoidPrimaryKey()` — 8 chars, lowercase alphanumeric. Short enough for URLs, long enough for a 6-module helpdesk.
- No cross-module `.references()`. Modules evolve independently; a foreign key across the boundary is a coupling commitment you will regret.
- Gap-free business numbers (INV-0001) via `nextSequence(tx, prefix)`.

## Agent harness

`bootWake` in `server/harness/` assembles the frozen system prompt once, drives turns through `pi-agent-core`'s stateful `Agent`, translates pi's event stream into our `AgentEvent` contract, dispatches tools through the mutator chain, and fans events to the observer bus. `llm-provider.ts` is the single provider seam: Bifrost when `BIFROST_API_KEY` + `BIFROST_URL` are set, direct OpenAI otherwise.

The non-obvious invariants (details in `server/harness/CLAUDE.md`):

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

OKLCH with two palettes (`:root` + `.dark`). `check:tokens` enforces both palettes cover every `var(--color-*)` in use and bans raw hex / `oklch()` / custom date formatters in `src/**`. Never write custom components for things shadcn / ai-elements / DiceUI already provide (empty states, stat cards, status badges, avatar groups, date displays, etc.) — install via `bunx shadcn@latest add <c>`, `bunx --bun ai-elements@latest add <c>`, or `bunx shadcn@latest add "https://diceui.com/r/<c>.json"`.

## What `@vobase/core` gives you

Imported as `import { ... } from '@vobase/core'` so you never read `node_modules`:
- types: `AgentTool`, `ToolContext`, `ToolResult`, `AgentEvent`, `HarnessEvent`, `WakeScope`, `ChannelAdapter`, `SendResult`, `SideLoadContributor`, `WorkspaceMaterializer`, `DirtyTracker`, `HarnessLogger`, `HarnessPlatformHint`, `ClassifiedErrorReason`, `MaterializerCtx`, `OnEventListener`, `ActiveWakesStore`
- tables: `auditLog`, `recordAudits`, `sequences`, `storageObjects`, `channelsLog`, `channelsTemplates`, `integrationsTable`, `authUser`, `authSession`, `authAccount`, `authApikey`, `authOrganization`, `authMember`, `agentMessages`, `threads`
- helpers: `nanoidPrimaryKey`, `nextSequence`, `trackChanges`, `createHttpClient`, `buildReadOnlyConfig`, `signHmac`, `verifyHmacSignature`, `setPlatformRefresh`, `getPlatformRefresh`
- errors: `notFound`, `unauthorized`, `forbidden`, `conflict`, `validation`, `dbBusy`

## Commands

- `docker compose up -d` — Postgres (pgvector/pg17, :5433)
- `bun run dev` — server :3001 + vite :5173; `dev:server` / `dev:web` run one half
- `bun run build` — vite production build
- `bun run typecheck` / `bun run lint` — must be 0 errors
- `bun run test` — full suite (CI entry point); `test:e2e` and `test:smoke` auto-discover everything in `tests/e2e` / `tests/smoke`; `bun test <path>` for a single file
- `bun run check` — runs every `check:*` in sequence
- `bun run db:reset` — nuke + push + seed; individual: `db:push`, `db:generate`, `db:migrate`, `db:nuke`, `db:seed`, `db:studio`

## Dev auth + deploy

Auth is email OTP via better-auth. Dev-only `POST /api/auth/dev-login` (`{ email, name? }`) bypasses OTP — used by seed, e2e, and agent-browser automation. Not available in production.

Dockerfile + `railway.json` included. Set `DATABASE_URL` for managed Postgres, `BIFROST_API_KEY` + `BIFROST_URL` (or `OPENAI_API_KEY`) for the LLM, `META_WA_*` to enable WhatsApp, `R2_*` to switch storage off local disk.

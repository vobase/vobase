# template-v2

Greenfield rebuild of the template package.

## Layout

- `server/` — backend infra (runtime, contracts, harness, workspace, middlewares, dev, db, `main.ts` bootstrap). Each subdir has its own CLAUDE.md.
- `modules/` — business domains (backend + frontend straddle per module; each conforms to the enforced module shape). See `modules/CLAUDE.md` for module shape + init order; per-module CLAUDE.md for domain rules (`agents`, `channels`, `drive`, `inbox`).
- `src/` — frontend shell only (TanStack Router, shadcn/ai-elements/DiceUI primitives, app-wide providers/layout). No module-specific code — see `src/CLAUDE.md`.
- `scripts/`, `docs/`, `tests/`, `e2e/`, `db/` — supporting

## Conventions

- Path aliases: `@server/*` → `server/*`, `@modules/*` → `modules/*`, `@/*` → `src/*`
- No `any`, no unsafe `as`, no `// @ts-ignore`
- Biome formatting + linting
- Core imports: `import { auditLog, ... } from '@vobase/core'`
- Harness: `import { Agent, type AgentEvent, type AgentTool, ... } from '@mariozechner/pi-agent-core'`; models via `@mariozechner/pi-ai` (`getModel`, `Type` for tool schemas)
- Virtual FS: `import { Bash, InMemoryFs } from 'just-bash'`
- Frontend data: TanStack Query hooks in `@modules/<m>/api/*`, never raw `fetch` in components. Realtime: service fires `pg_notify` after commit; `src/hooks/use-realtime-invalidation.ts` dispatches to query keys.
- Dates/times in UI: `<RelativeTimeCard date={...} />` only — `check:no-raw-date` fails on raw `toLocaleString` / `new Date().toString()` in `.tsx`.

## Testing

### Preconditions

Docker Postgres on port 5433 is required for every integration test. Run `docker compose up -d` from this directory before `bun run test`. `connectTestDb()` reads `DATABASE_URL` from `.env`; helpers never start/stop Docker themselves.

### Commands

| command | purpose |
|---|---|
| `bun run test` | full suite — `bun test e2e/ tests/ modules/ server/ src/` |
| `bun run test:unit` | unit suite — `bun test tests/ modules/ server/ src/` (skips e2e) |
| `bun run test:e2e` | e2e suite — `bun test e2e/` (needs Docker Postgres + optional LLM keys) |
| `bun test <path>` | single file, e.g. `bun test server/harness/agent-runner.test.ts` |
| `bun run typecheck` | `tsc --noEmit` — must be 0 errors |
| `bun run lint` | Biome — must be 0 errors |
| `bun run check` | aggregate: `check:shape` + `check:bundle` + `check:no-auto-nav-tabs` + `check:no-stub-flag` + `check:tokens` |
| `bun run check:shape` | module-shape lint (required files, handler LOC ≤ 200, journal write-path guard) |
| `bun run check:bundle` | forbids `src/**` from importing `@server/runtime/*` or `@server/harness/*` |
| `bun run check:tokens` | design-token lint (no raw hex colors in `.tsx`) |
| `bun run check:no-raw-date` | forbids raw date formatting in UI — use `RelativeTimeCard` |
| `bun run check:no-auto-nav-tabs` | forbids auto-generated nav tab files |
| `bun run check:no-stub-flag` | forbids `STUB_*` env flags sneaking back in |
| `bun run check:shadcn-overrides` | catches drifted shadcn component overrides |
| `bun run db:reset` | `db:nuke` + `db:push` + `db:seed` — fresh greenfield DB |

### Test layout

E2E tests (real Docker Postgres) live in `e2e/`. Unit tests live next to the code they cover under `modules/`, `server/`, and `src/`, with shared helpers in `tests/helpers/`. Multi-module integration scenarios live directly under `tests/` (`tests/phase1-green-thread.test.ts`, `tests/phase2-dogfood.test.ts`, `tests/phase3-dogfood.test.ts`, `tests/phase4-harness-hardening.test.ts`).

Stream behaviour in tests is expressed as inline `AssistantMessageEvent[]` scripts passed to `stubStreamFn`. `tests/fixtures/` is empty — no JSONL recorded-provider files; no `mockStream` / `createRecordedProvider` helpers.

### Test helpers (`tests/helpers/`)

- `test-db.ts` — `connectTestDb()`, `resetAndSeedDb()`, `TestDbHandle`.
- `test-harness.ts` — `buildIntegrationPorts(db)`, `bootWakeIntegration(ports, opts, db)`. `IntegrationBootOpts.mockStreamFn` takes a `StreamFnLike`.
- `stub-stream.ts` — `stubStreamFn(scripts, opts?)` replays canned `AssistantMessageEvent[]`, one array per LLM call. Missing terminal `done`/`error` is auto-synthesised.
- `simulated-channel-web.ts` — `createSimulatedChannelWeb({ inboxPort, contactsPort })` mimics the inbound-webhook handler.
- `assert-event-sequence.ts` — subset matcher that tolerates 0+ `message_update` deltas.
- `capture-side-load-hashes.ts` — snapshots per-turn sideLoad hashes for the frozen-snapshot invariant.
- `assert-learning-flow.ts` — shared assertions for the learning-proposal observer path.

### Provider selection in tests

Tests never hit a real LLM. Pass `streamFn: stubStreamFn([...])` to `bootWake` (or `mockStreamFn:` to `bootWakeIntegration`). `server/harness/llm-provider.ts` still runs `createModel` / `resolveApiKey` — with no `OPENAI_API_KEY` / `BIFROST_*` set, `resolveApiKey()` returns `undefined`, pi-ai skips the Authorization header, and the stub stream short-circuits before any HTTP call fires. Production selects Bifrost when `BIFROST_API_KEY` + `BIFROST_URL` are set, direct OpenAI otherwise.

### CI pipeline (`.github/workflows/template-v2.yml`)

One `test` job against a Postgres service. Steps: install → `typecheck` → `lint` → `check:shape` → `db:reset` + phase1 test → `db:reset` + phase2 + unit suites (`modules/`, `server/`) → phase3 test → phase4 harness-hardening test → phase4 live-smoke cache warning → `check:bundle` → deliberate-violation guard. Shell smoke workflow is `template-v2-shell.yml`; release is `release.yml`; template sync is `sync-template.yml`.

## Invariants

Covered by subfolder CLAUDE.md — read those when touching the area:
- One-write-path (messages/events/notes), message kinds, approval flow, mentions, realtime coupling → `modules/inbox/CLAUDE.md`
- A3 channels transport-only, `OUTBOUND_TOOL_NAMES` switch sync, whatsapp/webhook HMAC → `modules/channels/CLAUDE.md`
- Drive scope rules, virtual-field overlay, `BUSINESS.md`, proposal flow → `modules/drive/CLAUDE.md`
- Journal is sole writer of `conversation_events`, observer/mutator order, learning flow, wake triggers → `modules/agents/CLAUDE.md`
- Module shape + init order, cross-module service imports → `modules/CLAUDE.md`
- Frontend placement (module UI never in `src/`) → `src/CLAUDE.md`
- Frozen-snapshot, wake event order, abort/steer, byte budget → `server/harness/CLAUDE.md`
- `applyTransition` in `state.ts` only, observer vs mutator contracts, `llmCall` chokepoint → `server/runtime/CLAUDE.md`
- Exhaustiveness gate, journal write-path guard implementation → `server/contracts/CLAUDE.md`
- Materializers run before side-load (not system prompt), RO enforcement → `server/workspace/CLAUDE.md`

## Common patterns

```ts
// integration setup
beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  ports = await buildIntegrationPorts(db)
})

// boot a wake with a stub stream (integration helper)
const res = await bootWakeIntegration(ports, {
  organizationId, agentId, contactId, conversationId,
  mockStreamFn: stubStreamFn([[
    { type: 'done', reason: 'stop', message: { role: 'assistant', content: 'hi', stopReason: 'stop' } },
  ]]),
}, db)

// boot a wake directly (no DB) with inline stream scripts
const res = await bootWake({
  organizationId, agentId, contactId, conversationId,
  streamFn: stubStreamFn([[ /* AssistantMessageEvent[] for turn 1 */ ]]),
  registrations: makeRegs({ tools: [...], observers: [...], mutators: [...] }),
  ports, logger: noopLogger,
})

// assert event order, tolerating streaming deltas
const types = res.capturedEvents.map(e => e.type).filter(t => t !== 'message_update')
expect(types).toEqual([
  'agent_start', 'turn_start', 'llm_call',
  'message_start', 'message_end', 'turn_end', 'agent_end',
])
```

## Test anti-patterns (root-only)

- Don't mock the database — every integration test uses real Postgres via Docker.
- Don't introduce JSONL recorded-provider fixtures — stream behaviour is expressed inline via `stubStreamFn`.
- Don't add narrative Phase/Lane comments to test files.

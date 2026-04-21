# template-v2

Greenfield rebuild of the template package.

## Layout

- `server/` — backend infra (runtime, contracts, harness, workspace, db, server.ts bootstrap)
- `modules/` — business domains (straddle backend + frontend per module; each conforms to the enforced module shape — see `modules/CLAUDE.md`)
- `src/` — frontend shell (TanStack Router, shadcn/ai-elements/DiceUI)
- `scripts/`, `docs/`, `tests/`, `db/` — supporting

## Conventions

- Path aliases: `@server/*` → `server/*`, `@modules/*` → `modules/*`, `@/*` → `src/*`
- No `any`, no unsafe `as`, no `// @ts-ignore`
- Biome formatting + linting
- Core imports: `import { auditLog, ... } from '@vobase/core'`
- Harness: `import { Agent, type AgentEvent, type AgentTool, ... } from '@mariozechner/pi-agent-core'`; models via `@mariozechner/pi-ai` (`getModel`, `Type` for tool schemas)
- Virtual FS: `import { Bash, InMemoryFs } from 'just-bash'`

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
| `bun run check:shape` | module-shape lint (required files, handler LOC ≤ 200, journal write-path guard) |
| `bun run check:bundle` | forbids `src/**` from importing `@server/runtime/*` or `@server/harness/*` |
| `bun run db:reset` | `db:nuke` + `db:push` + `db:seed` — fresh greenfield DB |

### Test layout

E2E tests (real Docker Postgres) live in `e2e/`. Unit tests live next to the code they cover under `modules/`, `server/`, and `src/`, with shared helpers in `tests/helpers/`.

- `e2e/factory-isolation.test.ts` — proves per-organization factory services (`createFilesService`, etc.) don't leak across orgs in the same process.
- `server/harness/agent-runner.test.ts` — end-to-end `bootWake` against the pi-agent-core engine driven by `stubStreamFn(...)`. Covers frozen snapshot, event-order translation, tool dispatch, side-load caching across sub-turns.
- `tests/*.test.ts`, `server/harness/*.test.ts`, `server/runtime/*.test.ts`, `modules/<module>/**/*.test.ts`, `src/**/*.test.*` — unit tests colocated with their code.

Stream behaviour in tests is expressed as inline `AssistantMessageEvent[]` scripts passed to `stubStreamFn`. `tests/fixtures/` is empty — no JSONL recorded-provider files; no `mockStream` / `createRecordedProvider` helpers.

### Test helpers (`tests/helpers/`)

- `test-db.ts` — `connectTestDb()`, `resetAndSeedDb()`, `TestDbHandle` (pg + drizzle handles, teardown).
- `test-harness.ts` — `buildIntegrationPorts(db)`, `bootWakeIntegration(ports, opts, db)`. `IntegrationBootOpts.mockStreamFn` takes a `StreamFnLike` (build one with `stubStreamFn`).
- `stub-stream.ts` — `stubStreamFn(scripts, opts?)` builds a pi-agent-core `StreamFn` that replays canned `AssistantMessageEvent[]`, one array per LLM call. Missing terminal `done`/`error` is auto-synthesised.
- `simulated-channel-web.ts` — `createSimulatedChannelWeb({ inboxPort, contactsPort })` mimics the inbound-webhook handler.
- `assert-event-sequence.ts` — subset matcher that tolerates 0+ `message_update` deltas.
- `capture-side-load-hashes.ts` — snapshots per-turn sideLoad hashes for the frozen-snapshot invariant.
- `assert-learning-flow.ts` — shared assertions for the learning-proposal observer path.

### Provider selection in tests

Tests never hit a real LLM. Pass `streamFn: stubStreamFn([...])` to `bootWake` (or `mockStreamFn:` to `bootWakeIntegration`). `server/harness/llm-provider.ts` still runs `createModel` / `resolveApiKey` — with no `OPENAI_API_KEY` / `BIFROST_*` set, `resolveApiKey()` returns `undefined`, pi-ai skips the Authorization header, and the stub stream short-circuits before any HTTP call fires. Production selects Bifrost when `BIFROST_API_KEY` + `BIFROST_URL` are set, direct OpenAI otherwise.

### CI pipeline (`.github/workflows/template-v2-pr2.yml`)

Jobs: `typecheck`, `lint`, `check:tokens`, `check:no-raw-date`, `check:shape`, `check:bundle`, `theme-provider-test`, `integration-tests` (spins up Postgres service, runs `db:reset` then the e2e + modules + server suites), `smoke-staff-reply` (live dev server + `smoke:staff-reply`).

### Invariants tests enforce — do not bypass

- **One-write-path.** All `messages` / `conversation_events` writes go through `InboxPort.send*Message` / `agents.service.journal.append`. Direct `.insert(messages)` outside `modules/inbox/service/` or `modules/agents/service/journal.ts` is forbidden.
- **A3 dispatcher transport-only.** `modules/channels/*/service/dispatcher.ts` and `sender.ts` must not import drizzle or write to DB. `modules/channels/web/tests/dispatcher-transport-only.test.ts` guards this.
- **Frozen-snapshot.** System prompt hash identical across turns; mid-wake writes appear in turn N+1, never turn N. Enforced inside `server/harness/agent-runner.test.ts` via `capture-side-load-hashes.ts`.
- **A7 V2ChannelAdapter.** Refines core's `ChannelAdapter` via `sendOutboundEvent()`; must never override core's `send()`.
- **Module shape.** Every module ships `module.ts`, `manifest.ts`, `schema.ts`, `state.ts`, `service/index.ts`, `handlers/index.ts`, `jobs.ts`, `seed.ts`, and `README.md` with YAML frontmatter. Handler files ≤ 200 raw lines. `applyTransition()` only in `state.ts`. Domain modules call each other's services directly; only channel adapters ship `port.ts` (for `V2ChannelAdapter`).
- **Frontend bundle safety.** `src/**` must not import `@server/runtime/*` or `@server/harness/*`.
- **`OUTBOUND_TOOL_NAMES`.** New outbound tools must be added to the const in `server/contracts/channel-event.ts` AND the switch in `modules/channels/*/service/dispatcher.ts` + `sender.ts`.

### Common patterns

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

### Module conventions

- Factory services: `createXService({ db, organizationId })`. No file-level singletons.
- Every journal-appending mutation wraps in `ctx.withJournaledTx`.
- `check:shape` runs strict unconditionally. Manifests carry `name`, `requires`, `observers`, `mutators`, `commands`, `tools` — nothing else.
- Cross-module reads: import the service directly (`@modules/<name>/service/*`). The four domain port interfaces (`inbox`, `agents`, `contacts`, `drive`) exist only as the wiring contract for `PluginContext.ports`, not as a facade.

### Anti-patterns

- Don't mock the database — every integration test uses real Postgres via Docker.
- Don't bypass the inbox service (`appendTextMessage` / `appendCardMessage` / …) to write `messages`; the journal write-path guard fails if you do.
- Don't introduce JSONL recorded-provider fixtures — stream behaviour is expressed inline via `stubStreamFn`.
- Don't add narrative Phase/Lane comments to test files.
- Don't assume a write appears in the same turn it was made (frozen-snapshot discipline).
- Don't exceed 200 raw lines per handler file; lift logic into `service/`.

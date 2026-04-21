# template-v2

Greenfield rebuild of the template package. Phases 1–4 shipped.

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

E2E tests (real Docker Postgres, optionally real LLM keys) live in `e2e/`. Unit tests live next to the code they cover under `modules/`, `server/`, and `src/`, with shared helpers in `tests/helpers/` and fixtures in `tests/fixtures/`.

- `e2e/wake-loop-bootstrap.test.ts` — 14 `it()` blocks proving the bootstrap skeleton: schemas, seed, workspace materialization, harness event stream, journal write path, RO enforcement, approval gate, frozen-snapshot invariant, CI gates. Uses `mockStream(...)`.
- `e2e/wake-end-to-end.test.ts` — 13 `it()` blocks proving the live wake engine end-to-end: inbound webhook → wake → real LLM replay → tool call → approval block/approve/reject → outbound → SSE → mid-turn idempotency. Uses `createRecordedProvider('*.jsonl')`.
- `e2e/workspace-agent-loop.test.ts` — workspace-agent bash invocations, learning-proposal observer, moderation mutator, scorer observer, card-reply round-trip, Gemini caption, threat-scan wiring.
- `e2e/workspace-sync.test.ts` — workspace materializers (dirty writeback) + memory distill stub.
- `e2e/agent-adapter-integration.test.ts` — pi-agent-core adapter against a real wake.
- `e2e/live-provider-smoke.test.ts` — opt-in live Anthropic/OpenAI smoke (`USE_RECORDED_FIXTURES=false` + API keys).
- `e2e/nightly-gemini-drift.test.ts` — nightly live Gemini drift check (`GOOGLE_API_KEY` set).
- `tests/harness-hardening.test.ts` — harness convergence tests; no DB, no keys.
- `modules/<module>/*.test.ts`, `server/harness/*.test.ts`, `server/runtime/*.test.ts`, `src/**/*.test.*` — unit tests colocated with their code.

### Test helpers (`tests/helpers/`)

- `test-db.ts` — `connectTestDb()`, `resetAndSeedDb()`, `TestDbHandle` (pg + drizzle handles, teardown).
- `test-harness.ts` — `buildIntegrationPorts(db)`, `wireObserverContextFor(db, spy)`, `wireApprovalMutatorCtx(db)`, `bootWakeIntegration(ports, opts, db)`.
- `recorded-provider.ts` — `createRecordedProvider(fixtureFilename)` replays `.jsonl` stream events as an `LlmProvider`.
- `simulated-channel-web.ts` — `createSimulatedChannelWeb({ inboxPort, contactsPort })` mimics the inbound-webhook handler.
- `mock-stream.ts` — `mockStream([events])` for unit-level harness tests.
- `assert-event-sequence.ts` — subset matcher that tolerates 0+ `message_update` deltas.
- `capture-side-load-hashes.ts` — snapshots per-turn sideLoad hashes for the frozen-snapshot invariant.

### Deterministic CI via recorded fixtures

E2E assertions that touch a real LLM use `createRecordedProvider('<name>.jsonl')` instead of the Anthropic API. The JSONL files in `tests/fixtures/provider/` are one-event-per-line SSE replays (`meridian-hi-reply.jsonl`, `meridian-pricing-card.jsonl`, `meridian-pricing-card-reject.jsonl`). CI always replays; the nightly workflow (`.github/workflows/template-v2-nightly.yml`) swaps in the live API with `ANTHROPIC_API_KEY` to detect drift.

- Unit / harness tests → `mockStream([...])`.
- E2E wake tests → `createRecordedProvider(...)`.
- Do **not** re-record fixtures casually — CI determinism depends on stability. Re-record only when the provider API actually changes and commit the refreshed `.jsonl` alongside the test update.

### CI pipeline (`.github/workflows/template-v2.yml`)

Eight steps in order: `typecheck` → `lint` → `check:shape` → `db:reset` → `bun test e2e/wake-loop-bootstrap.test.ts` → `db:reset` (again — fixture isolation between suites) → `bun test e2e/wake-end-to-end.test.ts modules/ server/` → `check:bundle`. All must pass.

### Invariants tests enforce — do not bypass

- **One-write-path.** All `messages` / `conversation_events` writes go through `InboxPort.send*Message` / `agents.service.journal.append`. Direct `.insert(messages)` outside `modules/inbox/service/` or `modules/agents/service/journal.ts` is forbidden.
- **A3 dispatcher transport-only.** `modules/channels/*/service/dispatcher.ts` and `sender.ts` must not import drizzle or write to DB. `modules/channels/web/tests/dispatcher-transport-only.test.ts` guards this.
- **Frozen-snapshot.** System prompt hash identical across turns; mid-wake writes appear in turn N+1, never turn N. Enforced by `e2e/wake-loop-bootstrap.test.ts` assertion 12 and `e2e/wake-end-to-end.test.ts` assertion 10 via `capture-side-load-hashes.ts`.
- **A7 V2ChannelAdapter.** Refines core's `ChannelAdapter` via `sendOutboundEvent()`; must never override core's `send()`.
- **Module shape.** Every module ships `module.ts`, `manifest.ts`, `schema.ts`, `state.ts`, `service/index.ts`, `handlers/index.ts`, `jobs.ts`, `seed.ts`, and `README.md` with YAML frontmatter. Handler files ≤ 200 raw lines. `applyTransition()` only in `state.ts`. `port.ts` is no longer required (the four domain ports turned out to be 1:1 pass-throughs over the module's own service — call the service directly). Channel adapters keep `port.ts` because `V2ChannelAdapter` has multiple real impls.
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

// boot a wake with the mock path
const res = await bootWakeIntegration(ports, {
  organizationId, agentId, contactId, conversationId,
  mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
}, db)

// boot a wake with a recorded provider
const res = await bootWake({
  organizationId, agentId, contactId, conversationId,
  provider: createRecordedProvider('meridian-hi-reply.jsonl'),
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

### Module conventions (post-simplification)

- Factory services: `createXService({ db, organizationId })`. No file-level singletons.
- Every journal-appending mutation wraps in `ctx.withJournaledTx`.
- `check:shape` runs strict unconditionally. `accessGrants` and `manifest.tables` no longer exist.
- Cross-module reads: import the service directly (`@modules/<name>/service/*`). The four domain port interfaces (`inbox`, `agents`, `contacts`, `drive`) remain only as the wiring contract for `PluginContext.ports`, not as a required facade.

### Anti-patterns

- Don't mock the database — every integration test uses real Postgres via Docker.
- Don't bypass the inbox service (`appendTextMessage` / `appendCardMessage` / …) to write `messages`; the journal write-path guard fails if you do.
- Don't re-record provider fixtures casually; CI determinism depends on them.
- Don't add narrative Phase/Lane comments to test files (removed in the recent simplify pass).
- Don't assume a write appears in the same turn it was made (frozen-snapshot discipline).
- Don't exceed 200 raw lines per handler file; lift logic into `service/`.

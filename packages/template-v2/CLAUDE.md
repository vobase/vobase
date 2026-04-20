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
- pi-mono harness: `import { Agent, ... } from '@mariozechner/pi-agent-core'`
- Virtual FS: `import { Bash, InMemoryFs } from 'just-bash'`

## Testing

### Preconditions

Docker Postgres on port 5433 is required for every integration test. Run `docker compose up -d` from this directory before `bun run test`. `connectTestDb()` reads `DATABASE_URL` from `.env`; helpers never start/stop Docker themselves.

### Commands

| command | purpose |
|---|---|
| `bun run test` | full suite — `bun test tests/ modules/ server/ src/` |
| `bun test <path>` | single file, e.g. `bun test tests/phase2-dogfood.test.ts` |
| `bun test modules/ server/` | unit tests only (skip phase1/phase2 integration) |
| `bun run typecheck` | `tsc --noEmit` — must be 0 errors |
| `bun run lint` | Biome — must be 0 errors |
| `bun run check:shape` | module-shape lint (required files, handler LOC ≤ 200, no cross-module schema imports) |
| `bun run check:bundle` | forbids `src/**` from importing `@server/runtime/*` or `@server/harness/*` |
| `bun run db:reset` | `db:nuke` + `db:push` + `db:seed` — fresh greenfield DB |

### Test layout

- `tests/phase1-green-thread.test.ts` — **14 `it()` blocks** proving the Phase 1 skeleton: schemas, seed, workspace materialization, harness event stream, journal write path, RO enforcement, approval gate, frozen-snapshot invariant, CI gates. Uses `mockStream(...)`.
- `tests/phase2-dogfood.test.ts` — **13 `it()` blocks** proving the live wake engine end-to-end: inbound webhook → wake → real LLM replay → tool call → approval block/approve/reject → outbound → SSE → mid-turn idempotency. Uses `createRecordedProvider('*.jsonl')`.
- `modules/<module>/*.test.ts` and `modules/<module>/tests/*.test.ts` — per-module unit tests.
- `server/harness/*.test.ts`, `server/runtime/*.test.ts` — harness and runtime unit tests.

### Test helpers (`tests/helpers/`)

- `test-db.ts` — `connectTestDb()`, `resetAndSeedDb()`, `TestDbHandle` (pg + drizzle handles, teardown).
- `test-harness.ts` — `buildIntegrationPorts(db)`, `wireObserverContextFor(db, spy)`, `wireApprovalMutatorCtx(db)`, `bootWakeIntegration(ports, opts, db)`.
- `recorded-provider.ts` — `createRecordedProvider(fixtureFilename)` replays `.jsonl` stream events as an `LlmProvider`.
- `simulated-channel-web.ts` — `createSimulatedChannelWeb({ inboxPort, contactsPort })` mimics the inbound-webhook handler.
- `mock-stream.ts` — `mockStream([events])` for unit-level harness tests.
- `assert-event-sequence.ts` — subset matcher that tolerates 0+ `message_update` deltas.
- `capture-side-load-hashes.ts` — snapshots per-turn sideLoad hashes for the frozen-snapshot invariant.

### Deterministic CI via recorded fixtures

Phase 2 assertions that touch a real LLM use `createRecordedProvider('<name>.jsonl')` instead of the Anthropic API. The JSONL files in `tests/fixtures/provider/` are one-event-per-line SSE replays (`meridian-hi-reply.jsonl`, `meridian-pricing-card.jsonl`, `meridian-pricing-card-reject.jsonl`). CI always replays; the nightly workflow (`.github/workflows/template-v2-nightly.yml`) swaps in the live API with `ANTHROPIC_API_KEY` to detect drift.

- Unit / harness tests → `mockStream([...])`.
- Phase 2 integration → `createRecordedProvider(...)`.
- Do **not** re-record fixtures casually — CI determinism depends on stability. Re-record only when the provider API actually changes and commit the refreshed `.jsonl` alongside the test update.

### CI pipeline (`.github/workflows/template-v2.yml`)

Eight steps in order: `typecheck` → `lint` → `check:shape` → `db:reset` → `bun test tests/phase1-green-thread.test.ts` → `db:reset` (again — fixture isolation between suites) → `bun test tests/phase2-dogfood.test.ts modules/ server/` → `check:bundle`. All must pass.

### Invariants tests enforce — do not bypass

- **One-write-path.** All `messages` / `conversation_events` writes go through `InboxPort.send*Message` / `agents.service.journal.append`. Direct `.insert(messages)` outside `modules/inbox/service/` or `modules/agents/service/journal.ts` is forbidden.
- **A3 dispatcher transport-only.** `modules/channels/*/service/dispatcher.ts` and `sender.ts` must not import drizzle or write to DB. `modules/channels/web/tests/dispatcher-transport-only.test.ts` guards this.
- **Frozen-snapshot.** System prompt hash identical across turns; mid-wake writes appear in turn N+1, never turn N. Enforced by Phase 1 assertion 12 and Phase 2 assertion 10 via `capture-side-load-hashes.ts`.
- **A7 V2ChannelAdapter.** Refines core's `ChannelAdapter` via `sendOutboundEvent()`; must never override core's `send()`.
- **R1 domain types.** Hand-written `@server/contracts/domain-types.ts`; never `InferSelectModel` across module boundaries.
- **Module shape.** Every module ships `module.ts`, `manifest.ts`, `schema.ts`, `handlers/index.ts`, `port.ts`, and `README.md` with YAML frontmatter. Handler files ≤ 200 raw lines. No cross-module `schema.ts` imports. `applyTransition()` only in `state.ts`.
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
  tenantId, agentId, contactId, conversationId,
  mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
}, db)

// boot a wake with a recorded provider
const res = await bootWake({
  tenantId, agentId, contactId, conversationId,
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

### Anti-patterns

- Don't mock the database — every integration test uses real Postgres via Docker.
- Don't bypass `InboxPort` to write messages; Phase 2 A3 guard fails if you do.
- Don't re-record provider fixtures casually; CI determinism depends on them.
- Don't add narrative Phase/Lane comments to test files (removed in the recent simplify pass).
- Don't assume a write appears in the same turn it was made (frozen-snapshot discipline).
- Don't exceed 200 raw lines per handler file; lift logic into `service/`.

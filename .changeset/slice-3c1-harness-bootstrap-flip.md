---
'@vobase/template-v2': patch
---

Replace template-v2's hand-rolled `bootWake` / `ObserverBus` / `MutatorChain` with `createHarness` from `@vobase/core`.

- Delete `server/harness/agent-runner.ts` (942 LOC), `agent-runner.test.ts` (275 LOC), and `internal-bus.ts` (279 LOC) — ~1,500 LOC net removed.
- `server/wake-handler.ts` now builds its own workspace + frozen prompt and calls `createHarness` with plain `OnEventListener`s for SSE, workspace-sync, and memory-distill; message-history persistence routes through `onTurnEndSnapshot`.
- `modules/agents/service/wake-worker.ts` swaps its `BootWakeInvoker` + `EventBus` subscription for a narrow `RunHarnessFn` + `extraOnEvent` listener that forwards outbound tool calls idempotently.
- `Logger` consumers (`server/services.ts`, `server/common/port-types.ts`, `server/contracts/wake-context.ts`, `server/wake-handler.ts`) migrate to `HarnessLogger` imported from `@vobase/core`.
- Dead `PluginContext` / `ObserverFactory` / `AgentObserver` / `AgentMutator` types removed from `server/common/port-types.ts`.
- `tests/helpers/test-harness.ts` reworked on top of `createHarness`; `capture-side-load-hashes.ts` imports `CapturedPrompt` from core. Both remain compiling but unused by the active test suite.

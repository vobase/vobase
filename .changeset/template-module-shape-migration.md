---
"@vobase/core": minor
"@vobase/template-v2": minor
---

# Module-shape migration (slices 2c.1 → 2c.4)

Replace template-v2's manifest + `PluginContext` ceremony with a plain
named-export module shape wired through a generic `createHarness` in
`@vobase/core`. No runtime behaviour change; net ~−3,450 LOC in
template-v2.

## `@vobase/core`

Added:

- `createHarness({ agentDefinition, workspace, systemPrompt, systemHash,
  trigger, renderTrigger, model, getApiKey, tools, hooks, materializers,
  sideLoadContributors, commands, ... })` — generic harness around
  `@mariozechner/pi-agent-core`. Multi-listener `HarnessHooks`
  (`on_tool_call`, `on_tool_result`, `on_event`) compose over pi-agent's
  single-slot `beforeToolCall`/`afterToolCall` + multi-native
  `subscribe`. Optional `emitEventHandle: { emit?: (ev) => void }` so
  out-of-band callers (e.g. template `llmCall`) can surface synthesized
  events into the stream.
- `withJournaledTx(db, journal, fn)` — plain function (moved from
  template's `server/runtime/with-journaled-tx.ts`), generic over
  `TEvent`. Enforces journal append inside every domain transaction.
  `JournaledTxDb` minimal shape so core doesn't pull drizzle types.
- Types: `HarnessHooks`, `OnToolCallListener`, `OnToolResultListener`,
  `OnEventListener`, `HarnessBaseFields`, `HarnessEvent`, `LlmEmitter`
  re-exported from the main barrel.

## `@vobase/template-v2`

Deleted:

- `server/runtime/` — entire directory (boot-modules, define-module,
  plugin-context-factory, observer-bus, mutator-chain, scoped-scheduler,
  scoped-storage, validate-manifests, preflight, ~30 files).
- Contract files no longer needed: `plugin-context.ts`, `observer.ts`,
  `mutator.ts`, `module-shape.ts`. Types rehomed into
  `server/common/port-types.ts` + `server/harness/internal-bus.ts`.
- `server/ports.ts` (419 LOC) — decomposed into `realtime.ts`, `jobs.ts`,
  `module-ports.ts`.
- Every module's `manifest.ts` + `defineModule({...}).init(ctx)`
  wrapper. 9 modules now export named surfaces directly
  (`routes`, `tools`, `hooks`, `materializers`, `commands`, `jobs`,
  `schema`, `init?`).
- Audit, cost-aggregator, scorer, learning-proposal observers +
  moderation/approval mutators + their tests + the 4 llm-prompts files
  they depended on (these paths were never wired into boot; removing
  dormant infrastructure).
- Obsolete `check-module-shape.ts` checks (manifest-era ceremony).
  Guard shrunk from 376 → 59 LOC, retaining only
  `checkJournalWriteAuthority`.

Rewired:

- 4 active observers (sse, workspaceSync, messageHistory, memoryDistill)
  became plain `OnEventListener` functions closing over service
  singletons. No `{ id, handle }` wrapper, no `ObserverContext`.
- `server/app.ts` now mounts modules via a static import collector
  pattern. Module loader lives in `bootModulesCollector`.
- `applyTransition` helper moved to `server/common/`.
- Helpdesk-specific `DEFAULT_WRITABLE_PREFIXES` continues to live in
  core's RO enforcer; scheduled to move to template in slice 3c.

## Breaking (internal only — no installed consumers)

- `ObserverContext` and the `ctx.events` EventBus are gone. Listeners
  read wake identity directly from event `HarnessBaseFields`.
- `registerObserverFactory` / `registerMutator` APIs removed. Listeners
  register via module `hooks` export.
- `ScopedScheduler` / `ScopedStorage` removed. Modules consume raw
  adapters; queue/bucket naming is convention, not a runtime invariant.

## server/runtime/

Framework wiring with no domain knowledge. Non-obvious rules that drive the design:

**Observer vs mutator — different correctness contracts.** Observers are read-only, return nothing, throws are swallowed, each runs on its own async queue so a slow observer can't block the hot path. Mutators return `MutatorDecision | undefined` applied by the framework; first `block` wins; errors surface. Don't blur the line by reaching into DB from a mutator just because it's synchronous — if you need "react to events" use an observer; if you need "gate/transform the wake" use a mutator.

**Error classifier never coerces.** `classifyError()` → `context_overflow | payload_too_large | transient | unknown`. `unknown` never silently becomes `transient`; it surfaces and emits `error_classified` so provider drift is visible. `resilient-provider` retries only `transient` (3× exponential + jitter, honors `Retry-After` capped at 30s); `context_overflow`/`payload_too_large` compress once (drops oldest 50% + halves last message) then surface.

**`applyTransition` only in `state.ts`.** Handlers and services never call it directly. Keeps the state machine enumerable and testable.

**`llmCall` is the chokepoint.** Every LLM request — agent turn, compaction, scorer, moderation, memory distill, learn propose, caption — goes through `PluginContext.llmCall(task, request)`. Bypassing it drops task-tagged cost accounting and the `llm_call` event.

**Budget assessment is split.** `assessBudget()` (post-turn soft 70% / hard 100%) hard-stops. `worstCaseDeltaExceeds()` (pre-turn) refuses a turn that *would* breach using separate `lastCostPerInputToken`/`lastCostPerOutputToken` — this is why `LlmFinish` exposes `inputCostUsd`/`outputCostUsd` separately (Anthropic lumps cache reads into input).

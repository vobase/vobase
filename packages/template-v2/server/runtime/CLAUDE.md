## server/runtime/

Framework wiring with no domain knowledge. Non-obvious rules that drive the design:

**Observer vs mutator — different correctness contracts.** Observers are read-only, return nothing, throws are swallowed, each runs on its own async queue so a slow observer can't block the hot path. Mutators return `MutatorDecision | undefined` applied by the framework; first `block` wins; errors surface. Don't blur the line by reaching into DB from a mutator just because it's synchronous — if you need "react to events" use an observer; if you need "gate/transform the wake" use a mutator.

**Error classifier never coerces.** `classifyError()` → `context_overflow | payload_too_large | transient | unknown`. `unknown` never silently becomes `transient`; it surfaces and emits `error_classified` so provider drift is visible. Retries for the agent's main turn stream are owned by pi-agent-core; the classifier is used by the observer `llmCall` chokepoint (compaction, scorer, moderation, memory distill, caption) and to label `agent_aborted` errors.

**`applyTransition` only in `state.ts`.** Handlers and services never call it directly. Keeps the state machine enumerable and testable.

**`llmCall` is the chokepoint for non-turn work.** Every *non-agent-turn* LLM request — compaction, scorer, moderation, memory distill, learn propose, caption — goes through `PluginContext.llmCall(task, request)`. The agent's own turn stream is driven by pi-agent-core (`server/harness/agent-runner.ts`); it synthesizes its own `llm_call` event on pi's `message_end` using `message.usage`, so task-tagged cost accounting is preserved without re-routing the turn through this chokepoint. Bypassing `llmCall` from an observer/mutator still drops cost accounting and the event.

**Budget assessment is split.** `assessBudget()` (post-turn soft 70% / hard 100%) hard-stops. `worstCaseDeltaExceeds()` (pre-turn) refuses a turn that *would* breach using separate `lastCostPerInputToken`/`lastCostPerOutputToken` — this is why `LlmFinish` exposes `inputCostUsd`/`outputCostUsd` separately (Anthropic lumps cache reads into input).

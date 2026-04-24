## server/harness/

The hot path: `bootWake` assembles the frozen system prompt once, drives turns through `@mariozechner/pi-agent-core`'s stateful `Agent`, translates pi's event stream into our contract `AgentEvent` union, dispatches tools through the mutator chain, and fans events to the observer bus. `server/harness/llm-provider.ts` is the single provider seam: `createModel(id)` returns a pi-ai `Model<'openai-responses'>` whose `baseUrl` points at Bifrost when `BIFROST_API_KEY` + `BIFROST_URL` are set, direct OpenAI otherwise; `resolveApiKey()` picks the matching env var. Non-obvious invariants:

**Frozen snapshot.** System prompt computed once at `agent_start`; `systemHash` must be identical across every turn of a wake. Mid-wake writes (`vobase memory set`, `drive propose`, file ops) persist immediately but only appear in the NEXT turn's side-load — never the current turn, never the system prompt. Preserves the provider's prefix-cache hit rate (OpenAI/Bifrost Responses API) and prevents the agent from racing its own writes. New contributors go through `side-load-collector`, not the frozen prompt.

**User-turn vs pi sub-turn.** A "turn" in our contract = one `agent.prompt()` call. pi-agent-core runs its own internal multi-step tool loop between `prompt()` and `waitForIdle()`; its sub-turn `turn_start` / `turn_end` events are dropped from the contract stream. `TurnTracker` increments `turnIndex` only on user-turns. Side-load is built on the first `transformContext` call of a user-turn and cached across sub-turns. Our `llm_call` is synthesised on pi's `message_end` using `message.usage` + `Date.now() - turnStartedAt`.

**Three-layer byte budget for tool stdout.** L1=4KB inline preview; L2=100KB per-call spill to `/tmp/tool-<callId>.txt` (emits `tool_result_persisted`); L3=200KB turn-aggregate ceiling. Read-only re-reads of spill files are exempt (whitelist: `cat head tail less more wc grep awk sed`, plus `bash -c`/`sh -c` wrapping one of those); compound commands with `;`/`&`/`|` break the exemption. Bulk output spills instead of flooding context.

**Wake event order.** `agent_start → turn_start → llm_call → message_start → message_update* → message_end → (tool_execution_start → tool_execution_end)* → turn_end → … → agent_end`. Filter `message_update` when asserting sequences. Phase-4 peripherals: `budget_warning`, `error_classified`, `tool_result_persisted`, `steer_injected`, `wake_refused`, `agent_aborted`. All must stay exhaustively handled at their `switch` sites (observers/mutators).

**Abort/steer between turns, never inside.** `AbortSignal` propagates to tools; `SteerQueue.drain()` runs after `tool_execution_end` and injects text ahead of the NEXT turn's user message. LLM-stream throw under `abortSignal.aborted` → `agent_aborted` (classified `pre_tool | in_tool | post_tool`), not `agent_end:'complete'`.

**Restart recovery is a one-shot side-load.** If the previous wake's tail is `tool_execution_end` with no subsequent `message_end`/`agent_end`/`agent_aborted`, `restart-recovery` injects a `<previous-turn-interrupted>` block on turn 0 of the next wake.

**Prompt cache coherence.** Prefix caching is owned by the provider (OpenAI Responses / Bifrost). Keeping `systemPrompt` byte-stable across every pi call within a wake — the frozen-snapshot invariant — is what keeps the cache warm. Mutating it mid-wake breaks the prefix hash and forfeits the cache.

**Mid-wake arrival policy.** A wake is in-flight from `agent_start` to `agent_end`; events arriving during that window are routed by trigger type, not blindly queued. The rules below are enforced in `wake-handler.ts` + `SteerQueue`; they apply to the *same* `(agentId, conversationId)` — cross-conversation wakes are independent and never block each other.

| Arriving trigger | Policy | Mechanism |
|---|---|---|
| `inbound_message` (customer text/media) | Append to `SteerQueue`; drains after the current turn's `tool_execution_end` and injects ahead of the next user-turn. Text interrupts + queues; media-only messages merge into the queue without interrupting an in-progress tool call. | `SteerQueue.append` + `drain` between turns |
| `supervisor` (staff internal note addressed to the agent) | Hard abort the current wake and re-wake with `trigger: supervisor`. Staff intervention takes priority over whatever the agent was doing. | `AbortContext.abort('supervisor')` → re-wake |
| `approval_resumed` (staff approved a pending tool call) | Hard abort + re-wake with `trigger: approval_resumed`. The resumed approval path starts a fresh wake rather than splicing back into the aborted one. | `AbortContext.abort('approval_resumed')` → re-wake |
| `/stop` / explicit staff abort | Hard abort via `AbortContext`; no re-wake. | `AbortContext.abort('staff_stop')` |
| Any trigger for a different `conversationId` | Parallel wake in its own process; no blocking, no queueing. | normal wake dispatch |

Rationale: helpdesk semantics treat staff intervention and approvals as authoritative over the agent's in-flight plan, so those triggers *replace* the current wake rather than append. Customer messages are additive to the agent's context and flow through `SteerQueue` so the agent finishes its current tool call before integrating the new input. When enforcement drifts (e.g. a new trigger type is added without a rule), update this table and the dispatch switch together.

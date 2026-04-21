## server/harness/

The hot path: `bootWake` assembles the frozen system prompt once, runs turns, dispatches tools through the mutator chain, fans events to the observer bus. Non-obvious invariants:

**Frozen snapshot.** System prompt computed once at `agent_start`; `systemHash` must be identical across every turn of a wake. Mid-wake writes (`vobase memory set`, `drive propose`, file ops) persist immediately but only appear in the NEXT turn's side-load — never the current turn, never the system prompt. Preserves Anthropic prefix cache (~$800/mo at volume) and prevents the agent from racing its own writes. New contributors go through `side-load-collector`, not the frozen prompt.

**Three-layer byte budget for tool stdout.** L1=4KB inline preview; L2=100KB per-call spill to `/workspace/tmp/tool-<callId>.txt` (emits `tool_result_persisted`); L3=200KB turn-aggregate ceiling. Read-only re-reads of spill files are exempt (whitelist: `cat head tail less more wc grep awk sed`, plus `bash -c`/`sh -c` wrapping one of those); compound commands with `;`/`&`/`|` break the exemption. Bulk output spills instead of flooding context.

**Wake event order.** `agent_start → turn_start → llm_call → message_start → message_update* → message_end → (tool_execution_start → tool_execution_end)* → turn_end → … → agent_end`. Filter `message_update` when asserting sequences. Phase-4 peripherals: `budget_warning`, `error_classified`, `tool_result_persisted`, `steer_injected`, `wake_refused`, `agent_aborted`. All must stay exhaustively handled in `server/contracts/__checks__/integration.ts`.

**Abort/steer between turns, never inside.** `AbortSignal` propagates to tools; `SteerQueue.drain()` runs after `tool_execution_end` and injects text ahead of the NEXT turn's user message. LLM-stream throw under `abortSignal.aborted` → `agent_aborted` (classified `pre_tool | in_tool | post_tool`), not `agent_end:'complete'`.

**Restart recovery is a one-shot side-load.** If the previous wake's tail is `tool_execution_end` with no subsequent `message_end`/`agent_end`/`agent_aborted`, `restart-recovery` injects a `<previous-turn-interrupted>` block on turn 0 of the next wake.

**Prompt cache key memoized.** Anthropic provider computes `prompt_cache_key = sha256(system).slice(0,16)` once per provider instance. Mutating the system prompt between calls within a wake breaks cache coherence.

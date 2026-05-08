---
"@vobase/template": patch
"create-vobase": patch
---

Test infrastructure: consolidate the smoke runtime.

`tests/helpers/smoke-runtime.ts` is now the single source of truth for live-smoke plumbing — `runSmoke` wrapper, single DB connection, `pollAssistantTurns` with 1s→3s exponential backoff, `pickText`/`pickToolCalls`, `SMOKE_AGENT_ID`, and `dumpConversationState`. The five standalone smokes (`smoke-{inbound,conversation,staff-note,operator-thread,heartbeat}-live.ts`) shrink from 796 LoC to 451 LoC (~43%).

The big win is failure inspectability: a failing smoke now prints customer messages, agent text, tool calls **with arguments**, tool-result stderr, the wake's journal sequence, change proposals, and `change.*` lifecycle events — not opaque `expected 1 got 0` counts.

Also drops the orphaned `_smoke-coach-stale.ts`, renames `smoke-wa-{echo,inbound}-live.test.ts` → `*-live.ts` so they no longer get auto-picked-up by `bun test`, fixes `pickToolCalls` to match the canonical `'toolCall'` literal (was checking the non-existent `'tool_call'`), and centralises the seed agent id.

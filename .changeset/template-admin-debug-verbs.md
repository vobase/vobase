---
"@vobase/template": minor
---

feat(agents,messaging): admin-tier CLI verbs for live-tenant debugging

Adds a read-only debug surface so operators on remote deployments can diagnose agent behavior without direct DB access:

- `agents debug wakes --conversationId=<id>` — wake-by-wake summary (trigger, turns, tool calls, cost, `systemHash`, end reason). The `systemHash` column reveals frozen-snapshot drift across wakes.
- `agents debug timeline --wakeId=<id> [--full]` — per-wake event timeline from `harness.conversation_events` (turn_start, message_*, tool_dispatch_*, tool_execution_*, llm_call, agent_end). Truncates content to 200 chars unless `--full`.
- `agents debug llm-io [--conversationId|--wakeId] [--seq=N:M] [--role] [--tool] [--limit] [--full]` — dump of `harness.messages` showing what pi-agent-core sent/received: user cues, assistant tool-calls with arguments, tool results, token + cost per row. `--wakeId` auto-derives the conversation and `agent_start..agent_end` time window.
- `messaging messages --id=<conv>` — staff-tier verb returning customer/agent/staff message bodies (complements `messaging show` which returns activity events but no bodies).
- `messaging notes --id=<conv>` — staff-tier verb that renders `INTERNAL-NOTES.md` byte-identical to the materializer the agent reads inside its bash sandbox.

All five verbs route through a new `DebugReadersService` (singleton + free-function wrappers, matching the agents-module convention) and respect organization scoping.

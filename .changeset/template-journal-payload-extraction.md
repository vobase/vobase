---
"@vobase/template": patch
---

fix(wake/build-base): route journal writes through `appendJournalEvent` wrapper

`buildJournalAdapter` called core's `journalAppend` directly, which only persists the reserved columns and drops every non-reserved AgentEvent field. As a result `agent_start.payload` landed as `null` and downstream debug surfaces couldn't recover `trigger`, `triggerPayload`, `systemHash`, or `agent_end.reason`. The template wrapper at `@modules/messaging/service/journal` auto-extracts those fields into the `payload` jsonb column — now used by every flavour.

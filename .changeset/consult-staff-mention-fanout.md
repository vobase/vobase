---
'@vobase/template': patch
---

Fire mention notifications from the `consult_staff` agent tool

`consult_staff` wrote the internal note with resolved `mentions` but never
fired `fanOutNoteMentions` — so addressed staff got no WhatsApp ping when
offline, and no `pending_mention_pings` ledger row was recorded (the row that
correlates a staff member's WA reply back to the conversation and wakes the
agent). The fan-out only ran from the HTTP notes handler, not the agent
write path.

`consult_staff` now fires `fanOutNoteMentions(row)` after the note write,
fire-and-forget so a flaky provider can't fail the note. This makes the tool
the agent-write-path twin of the HTTP notes handler. Failures log via the
structured `logger`; the synchronous "service not installed" path (unit-test
contexts) is guarded and logged at `warn`.

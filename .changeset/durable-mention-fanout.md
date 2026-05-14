---
'@vobase/template': patch
---

Move the WhatsApp mention fan-out behind a durable pg-boss job

`fanOutNoteMentions` does WhatsApp I/O per mentioned staff member and writes
the `pending_mention_pings` correlation row that wakes the asking agent on a
reply. It was invoked fire-and-forget (`void ...catch()`) from the
`consult_staff` agent tool and the HTTP notes handler — so a process recycle
mid-send silently lost the fan-out and its ledger row.

It now runs behind a `team:fanout-mention-pings` pg-boss job: producers call
`enqueueMentionFanOut`, the team job handler runs `fanOutNoteMentions` on the
worker. The work survives a process recycle and gets pg-boss retry semantics,
with a per-note `singletonKey` deduping retries. The job payload is
Zod-validated at the handler boundary and carries only the note fields the
fan-out consumes.

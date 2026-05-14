---
'@vobase/template': minor
---

feat(messaging): split the agent write-surface into three audience-named tools

During testing the agent jumped to `reply` too quickly — answering the customer
before exploring the workspace — and over-indexed on the customer while
under-communicating with staff. The root cause was structural: the customer
transcript was *pushed* into every turn's prompt while the staff thread was a
*file the agent had to remember to open*, and the single write verb the agent
confused (`reply`) was named without an audience.

## Three audience-named tools

The messaging agent surface is now explicit about *who* a message reaches:

- **`reply_contact`** — renamed from `reply`. Plain-text message to the customer.
  The rename is threaded through everywhere: `OUTBOUND_TOOL_NAMES`, the
  `staff_note` default-deny set, outbound dispatch, and the journal `toolName`.
- **`consult_staff`** — new. A first-class agent→staff directed-messaging tool
  (`lane: 'both'`). Addresses one or more colleagues by userId or display name,
  writes the note with resolved `staff:<userId>` mentions, and is available on
  both conversation and standalone wakes.
- **`add_note`** — `mentions` removed. Now purely an undirected timeline
  breadcrumb: no recipient, no notification.

Staff-token resolution (userId / `user:<id>` / display-name → `staff:<userId>`,
with a deterministic roster error on unresolved tokens) is extracted into
`modules/messaging/tools/lib/resolve-staff-mentions.ts`, shared by `consult_staff`.

## Two co-equal threads, not one primary file

`MESSAGES.md` and `INTERNAL-NOTES.md` are now framed as two threads of one
conversation with equal standing. `conversationSideLoad` pushes unaddressed
staff-thread content into the prompt — when a staff note is newer than the
agent's last action, the staff thread becomes as unmissable as the customer
transcript instead of a file the agent has to choose to read. The per-turn Task
instruction is reframed from "respond to the customer now" to a two-audience
frame: check the staff thread first, then reply to the customer grounded in what
was read.

Prompt and wake-cue text across `messaging/agent.ts`, `wake/trigger.ts`, and the
`update_contact` / `conv reassign` / `team list` / agent-seed prose is updated to
point at `consult_staff` instead of `add_note` + `mentions`, and to describe the
workspace in workspace terms rather than framework internals.

## Follow-ups

- `consult_staff` writes the note + mentions but does not itself fire the staff
  WhatsApp/in-app notification — that fan-out (`fanOutNoteMentions`) currently
  only runs from the HTTP notes handler, not the agent write path. This is
  pre-existing behaviour inherited from `add_note` + `mentions`; wiring it into
  the agent path is tracked separately.
- Agent-facing prompt vocabulary still says "customer" in places; aligning it to
  the tenant-agnostic "contact" is a separate sweep.

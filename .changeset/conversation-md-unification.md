---
'@vobase/template': minor
---

feat(messaging): unify the customer transcript and staff thread into one CONVERSATION.md

The conversation workspace exposed two materialized files — `MESSAGES.md`
(the customer-visible transcript) and `INTERNAL-NOTES.md` (the staff thread).
That layout structurally encoded the staff thread as a secondary file the
agent had to remember to open, which worked against treating staff as a
co-equal audience.

## One interleaved timeline

`MESSAGES.md` and `INTERNAL-NOTES.md` are replaced by a single
`/contacts/<id>/<channelInstanceId>/CONVERSATION.md` — customer messages, the
agent's replies, and internal staff notes interleaved in time order. Each row
is audience-labelled:

- Customer-visible: `**Customer**`, `**Agent → customer**`, `**Staff → customer**`
- Internal: `**[internal] Agent**`, `**[internal] Staff:<id>**`, `**[internal] System**`

A staff note that landed right before the current customer message is now the
next line in the file, not a different file — structurally unmissable. The
merge is deterministic (equal timestamps break ties by message-before-note,
then id), so the materialized file stays byte-stable across re-renders within
a wake and the frozen-snapshot `systemHash` invariant holds.

`conversationSideLoad` collapses accordingly: it pushes one merged timeline,
and the previous conditional whole-`INTERNAL-NOTES.md` re-dump becomes a
one-line banner when a colleague's note is newer than the agent's last action.

## Audience-boundary hardening

With customer-visible and staff-only content now in one file, the `**…**` row
header is the only thing telling the agent which audience a row belongs to.
Untrusted body content (customer message text, staff note bodies) is
blockquoted so a column-0 `**` is renderer-only — a message or note body
cannot typographically forge a row header of a different audience. Mention
tokens in the note header are stripped to the id charset for the same reason.

## One row format everywhere

The agent sees conversation content in three places — the `CONVERSATION.md`
timeline, the wake-cue trigger renderers, and the unread-activity appendix —
and they previously rendered it three different ways. A shared
`modules/messaging/lib/conversation-row.ts` now owns the row vocabulary
(`messageAudienceLabel` / `noteAudienceLabel`), the blockquoting of untrusted
body text, and the timestamp format, so all three render the same
`**<audience>** (<timestamp>) <note>:` header + blockquoted body. The
unread-activity appendix's note rows now carry the `[internal]` audience
marker that previously only `CONVERSATION.md` had.

## Timezone-aware timestamps

Conversation timestamps render in the org timezone (`ORG_TIMEZONE`) with an
explicit offset — e.g. `2026-05-14 18:30 GMT+08:00` — instead of bare UTC.
`formatRowTimestamp` is deterministic for a fixed input (no clock read), so it
is safe inside the frozen-snapshot renderers.

## Surface updates

The rename is threaded through the read-only config, RO-error hints, the
`conversation-surface` AGENTS.md contributor, the `wake/trigger.ts` cue
renderers (inbound / staff-note / caption-ready), `wake/unread-activity.ts`
overflow pointers, the frozen-prompt preamble, the INDEX.md conversation
links, and the WhatsApp echo-coexistence prose.

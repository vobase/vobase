## modules/inbox/

Single write path for all customer-visible messages and internal notes. Owns `conversations`, `messages`, `internal_notes`, `pending_approvals`.

**One write path.** `service/messages.ts` is the ONLY place that writes to `messages`. `service/notes.ts` is the only place that writes to `internal_notes`. All channels, tools, and the harness go through `InboxPort`. Direct `.insert(messages)` outside these files is forbidden (enforced by the dispatcher-transport-only test).

**Message kinds:** `text | image | card | card_reply`. `card` comes from `send_card` (a `CardElement` tree per chat-sdk schema); `card_reply` is the customer's button tap correlated back via the channel handler.

**Approval flow.** `send_card`/`send_file`/`book_slot` are outbound tools — `approvalMutator` blocks them at `tool_execution_start`, writes a `pending_approvals` row, conversation moves to `awaiting_approval`. Staff decides via `POST /api/inbox/approvals/:id/decide`; approval fires an `approval_resumed` wake trigger so the agent continues. Reject reasons feed the learning flow as anti-lessons.

**Staff consultation via internal notes.** `@staff:<id>` in an internal note triggers a WhatsApp notification to that staff member (via channel-whatsapp sender). The staff's reply on WA correlates back via `notif_channel_msg_id`, which fires a `supervisor` wake trigger carrying the note. This is how humans teach the agent during live conversations without context-switching into the admin UI.

**State machine** (`state.ts`): `open → awaiting_approval → open | escalated | closed`. Only `applyTransition` in `state.ts` mutates status.

**Typed tools own content, bash owns navigation.** The LLM creates customer-visible content via typed tools (`reply`, `send_card`, `send_file`, `book_slot`) — schemas enforce shape. Navigation/metadata (`ls`, `cat`, `grep`, `vobase memory set`) goes through bash against the virtual FS.

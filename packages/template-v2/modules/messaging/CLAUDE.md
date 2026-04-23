## modules/messaging/

Single write path for all customer-visible messages and internal notes. Owns `conversations`, `messages`, `internal_notes`, `pending_approvals`, `mention_dismissals`.

**One write path.** `service/messages.ts` is the ONLY place that writes to `messages`. `service/notes.ts` is the only place that writes to `internal_notes`. All channels, tools, and the harness go through the messaging service layer. Direct `.insert(messages)` outside these files is forbidden (enforced by the journal write-path guard).

**Message kinds:** `text | image | card | card_reply`. `card` comes from `send_card` (a `CardElement` tree per chat-sdk schema); `card_reply` is the customer's button tap correlated back via the channel handler.

**Approval flow.** `send_card`/`send_file`/`book_slot` are outbound tools — `approvalMutator` blocks them at `tool_execution_start`, writes a `pending_approvals` row, conversation moves to `awaiting_approval`. Staff decides via `POST /api/messaging/approvals/:id/decide`; approval fires an `approval_resumed` wake trigger so the agent continues. Reject reasons feed the learning flow as anti-lessons.

**Mentions + staff consultation.** Internal notes carry a first-class `mentions: string[]` column (GIN-indexed). Authoring UI (`components/composer.tsx`) uses a `@`-mention picker. Fan-out on write: each mentioned staff's prefs (`settings.notification_prefs`) decide which channels notify — in-app badge (always), plus optional WhatsApp / email. The WA path writes `notif_channel_msg_id` on the note; the staff's WA reply correlates back and fires a `supervisor` wake trigger carrying the note body. `mention_dismissals` is per-user read-state for the in-app badge — one row per (userId, noteId) marks the mention acknowledged. Notes are read via `GET /api/messaging/conversations/:id/notes` and rendered interleaved with messages in the timeline.

**State machine** (`state.ts`): `open → awaiting_approval → open | escalated | closed`. Only `applyTransition` in `state.ts` mutates status.

**Typed tools own content, bash owns navigation.** The LLM creates customer-visible content via typed tools (`reply`, `send_card`, `send_file`, `book_slot`) — schemas enforce shape. Navigation/metadata (`ls`, `cat`, `grep`, `vobase memory set`) goes through bash against the virtual FS.

**Realtime.** `conversations`, `messages`, `notes`, `approvals`, and `learning_proposals` mutations fire pg NOTIFY → SSE. Frontend hook `src/hooks/use-realtime-invalidation.ts` maps each channel to the right TanStack Query keys; when adding a new realtime surface, add both the NOTIFY emitter and the invalidation branch.

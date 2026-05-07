---
'@vobase/template': patch
---

# Internal-note attribution + @-mention-only supervisor fan-out

Two related fixes around staff-authored internal notes.

## Timeline now shows real names instead of "Customer" / "Staff"

Two attribution bugs in the conversation timeline:

- **Internal notes always rendered as "Staff."** `useSendNote` was hard-coding `authorId: 'staff'` (literal string) when posting, so `internal_notes.author_id` could never be resolved by the principal directory and every freshly-sent note fell through to the generic "Staff" label. The hook now requires the real `currentUserId` (passed in from `useCurrentUserId()` in `Composer`) so notes carry the canonical `staff:<userId>` token and resolve to the staff member's display name + avatar.
- **Customer messages always rendered as "Customer."** `messagePrincipal` returned `null` for `role === 'customer'` because rows don't carry a sender id, leaving the bubble's fallback ("Customer") in place. `MessageThread` now accepts the conversation's `contactId`; customer rows resolve via `directory.resolve('contact:<id>')` to the actual contact name. `ConversationDetail` threads `contactId` through. The other `MessageThread` caller (`ConversationContextSnippet` in proposal rows) doesn't have a `contactId` in scope and keeps the previous "Customer" fallback — no behavior change there.

Staff-message rows still resolve to the alphabetically-first staff member because `messages` rows don't carry a `senderUserId` column; that's a schema change separate from this fix.

## Internal notes only wake an agent when the agent is @-mentioned

Previously, every staff-authored note triggered an unconditional supervisor wake on the conversation's assignee agent — which in turn appended a "memory note" entry as the agent processed the wake. The new rule is simpler and matches staff intent: **a note only wakes an agent when staff explicitly `@-mentions` that agent.**

Effects:

| Note in MeriGPT-assigned conv | Before | After |
| --- | --- | --- |
| `"hey team, fyi"` (no mention) | 1 wake (assignee) | **0 wakes** |
| `"@Sentinel can you look?"` | 2 (assignee + Sentinel) | **1 (Sentinel)** |
| `"@MeriGPT please double-check"` (self-mention) | 1 (assignee, `mentionedAgentId=undefined`) | **1 (with `mentionedAgentId=MeriGPT`)** |
| `"@Sentinel @Atlas"` | 3 | **2** |
| Agent-authored note | 0 | **0 (unchanged)** |

`runSupervisorFanOut` (`modules/messaging/service/notes.ts`) drops the unconditional assignee self-wake and the self-mention skip; it now iterates only over agents resolved by `resolveAgentMentionsInBody` and short-circuits when there are none.

`isPeerWake` in `wake/conversation.ts` is redefined from "the booted agent IS the mentioned one" to "the booted agent is NOT the conversation assignee." This preserves the original "ownership" distinction across the fan-out change: an `@`-mentioned assignee still goes through the `coaching` / `ask_staff_answer` classifier (and the coaching-strip filter on customer-facing tools), while an `@`-mentioned non-assignee continues to behave as a peer consultation with reply tools available but a render that explicitly tells them not to send a customer-facing reply.

`tests/e2e/supervisor-mention-fanout.test.ts` updated to reflect the new shape — cases (a)–(d) lose the implicit assignee wake and case (b) self-mention now carries `mentionedAgentId=MeriGPT`. New case `(f)` covers the "plain note → 0 enqueues" path so the @-mention-only rule has explicit coverage.

**Changed:**

- `modules/messaging/hooks/use-send-note.ts` — `useSendNote(conversationId, authorId)` now requires the real user id; throws on a null `authorId`.
- `modules/messaging/components/composer.tsx` — passes `useCurrentUserId()` into the hook.
- `modules/messaging/components/message-thread.tsx` — `MessageThread` accepts `contactId`; `messagePrincipal` resolves customer rows via `contact:<id>`.
- `modules/messaging/components/conversation-detail.tsx` — threads `contactId` through.
- `modules/messaging/service/notes.ts` — supervisor fan-out only enqueues for `@-mentioned` agents.
- `wake/conversation.ts` — `isPeerWake` reframed against the conversation assignee.
- `wake/supervisor.ts`, `runtime/bootstrap.ts` — doc comments updated.
- `tests/e2e/supervisor-mention-fanout.test.ts` — assertions updated for the new fan-out, plus a new plain-note coverage case.

No schema changes.

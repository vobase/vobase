---
'@vobase/template': patch
---

fix/feat(wake, messaging, realtime, channels): backport batch from downstream tenant

Sixteen changes rolled up from a production tenant where each was
verified against live agent traffic. Grouped by area:

## wake/learning (triage)

1. **Resolved model id passed to triage LLM.** Triage was passing the
   bare alias key `gpt_mini` as `LlmRequest.model`; `createModel`
   expects the fully-qualified `provider/model` id, so the lookup
   silently fell back to `DEFAULT_CHAT_MODEL` (Sonnet), defeating the
   cheap-model triage. `thresholds.ts` now hardcodes `triageModel` to
   `models.gpt_mini`; `triage-prompt.ts::shouldStubTriage` switches on
   the `openai/` / `anthropic/` / `google/` provider prefix.

2. **Triage drop log + prompt clarity.** A `self_reflection` signal
   dropped with confidence 0.97 read like a threshold bug, but
   `worth_attention` is the gate and `confidence` is the LLM's
   certainty about that classification — a confident "no" is also
   high confidence. Log line now spells out
   `worth_attention: false`. Dropped the contradictory "if not worth
   attention then confidence ≤ 0.2" instruction from the system
   prompt and added a signal-interpretation block: for
   `self_reflection` the journal activity is the signal, while for
   `staff_takeover` / `coexistence_echo` / `coaching_note` /
   `rejection` the `signalBody` is the signal.

3. **Expanded triage LLM context.** The cheap-model triage was running
   with a 10-row text-only journal, no contact memory, and no
   agent-role description. Now pulls `agent_definitions.instructions`
   (head 300 chars), wires `contactMemoryHead` via `conversations` →
   `contacts.memory`, appends `toolName` + `toolCalls` + `payload`
   from `conversation_events`, bumps the journal window 10 → 20 rows
   and truncation 2000 → 4000 chars. The three context queries run
   in parallel via `Promise.all`. Sub-cent per triage on `gpt_mini`.

4. **`journalContext` sourced from `messaging.messages`.** The triage
   prompt's journal was reading `harness.conversation_events`, which
   only contains wake harness events and conversation lifecycle rows
   — the actual customer/staff/agent message bodies live in
   `messaging.messages`. Replaced the query and rendered each row via
   the canonical `summarizeMessageContent` (matching `vobase
   messaging messages` and the unread-activity preamble).

## wake (conversation cue + debounce)

5. **Unread activity inlined into conversation-lane wake cues.** Wakes
   now carry an activity preamble (customer messages, staff notes,
   internal events) so the agent sees what happened during its
   absence without a separate tool call.

6. **Trigger leads, activity is appendix.** When a `staff_note` wake
   fired alongside customer frustration messages from the prior wake,
   the unread-activity preamble landed above the trigger cue and the
   agent attended to the customer pile first. Flipped the cue order:
   trigger first, `---`, then the activity block.

7. **Inbound bursts debounced to one wake per conversation.** Multiple
   inbound messages arriving in quick succession used to each enqueue
   a wake; only the first now wins until the wake drains, the rest
   are coalesced via a state-machine update in `channels/service/state.ts`.
   New live smoke: `tests/smoke/smoke-debounce-live.ts`.

## messaging

8. **Staff-note actions described as composable in AGENTS.md.** The
   routing table presented its bullets as mutually exclusive paths,
   so the agent picked one ("relay") and stopped — needing three
   subsequent prompts to coax a memory write. Intro now names the
   dual nature of brief staff answers; step 2 heading notes that
   more than one bullet often applies.

9. **Staff "mine" alignment scoped to the actual sender.** Message-thread
   alignment was using `directory.staff[0]` as the implicit "me",
   causing every staff message to right-align for every staff viewer.
   Now matches against the resolved viewer id.

10. **Staff author matched from `[Name]` prefix, not
    `directory.staff[0]`.** New `messaging/lib/staff-prefix.ts` parses
    the bracketed name prefix; `staff-reply.ts` and
    `message-thread.tsx` consume it for both write and render.

## realtime

11. **`safeNotify` helper consolidates notify try/catch.** `runtime/index.ts`
    now exports `safeNotify`; `contacts`, `team`, and `agents` services
    use it instead of inline try/catch blocks around `pg_notify`.

12. **Inbox names refresh live; ownership filter labels resolve.**
    `agents`/`team` modules now declare realtime keys for their
    principal rows; `use-realtime-invalidation.ts` maps them so the
    conversation list and ownership filter relabel without a manual
    refresh.

## channels (web adapter)

13. **"Open" button on web-channel table rows.** New
    `channels/components/chat-url.ts` derives the public `/chat/<id>`
    URL; the row menu and details sheet expose it.

14. **Public `/chat` page no longer sticks on "Assistant is thinking…".**
    The web adapter's `messages` handler now emits a turn-end event
    the chat page consumes; `wake/workspace/create.test.ts` updated.

## runtime

15. **Request logger dropped to debug and off in production.** Hono
    logger was at info; in production it spammed access logs without
    adding signal. Set to debug, env-gated off in production.

## docs

16. **`vobase-cli-ops` skill** — `--local` version floor, auth
    troubleshooting, drive verb notes. (Shared skill — already in sync
    at the repo root, no template change.)

---
"@vobase/template": patch
---

# WhatsApp card rendering, agent handoff UX, and supervisor coaching fixes

Six related fixes uncovered while debugging local-chat conversations on the
managed-WhatsApp sandbox.

**WhatsApp `send_card` now renders all child elements.** Outbound dispatch
previously squashed cards to `title + subtitle`, dropping every `fields`,
`text`, `link`, `image`, `divider`, and `link-button` child. The new
`cardToOutbound` helper walks card children in order and emits a real
`metadata.interactive` payload — `type=button` for ≤3 reply buttons,
`type=list` for 4–10. Non-WhatsApp channels fall back to plain text. Footer
is intentionally not auto-promoted from a trailing text child (the schema has
no footer signal and any heuristic misclassifies normal prose).

**Web inbox card buttons are read-only for staff.** The web `MessageCard`
now threads a `readOnly` prop down to `CardActions`; the staff inbox passes
it (`message-thread.tsx`), so buttons render disabled and never POST a
card-reply. The first reply button's `primary` style maps to `default` on
web — leading-button emphasis is a WA/Teams renderer convention that read as
a bug in the inbox.

**Agent → human reassignment requires a customer-facing acknowledgment.**
Adds `messages.hasRecentAgentReply(conversationId, withinSeconds)` and gates
`conv reassign --to=user:<id>` on it: the verb refuses with
`errorCode: 'no_customer_ack'` if the agent hasn't sent a `reply` /
`send_card` / `send_file` in the last 60 seconds. Verb description and
`prompt` rewritten as a 3-step handoff playbook so the agent is told
explicitly to acknowledge BEFORE flipping the assignee.

**Managed-WhatsApp adapter no longer races vault load.** The previous
`void loadRotation(...).catch(swallow)` warm-load could resolve after the
first outbound, throwing "vault not yet loaded" on the wire. The factory
now awaits the initial rotation load; `loadRotation` deduplicates concurrent
calls so subsequent adapter constructions for the same org pay an in-memory
hit. `ChannelAdapterFactory` now accepts `Promise<ChannelAdapter>`;
`registry.get()` is async; every caller (`outbound`, `inbound`,
`mention-notify`) awaits.

**Supervisor coaching wakes get a clearer playbook.** `wake/trigger.ts`
leads with `cat <conv>/internal-notes.md` so the model can't treat reading
the staff note as optional, then directs the agent to capture a durable
lesson in MEMORY.md. `wake/prompt.ts` reorders the system prompt so
`MEMORY.md` (renamed to "## Active lessons — apply these rules on every
reply") sits before AGENTS.md — durable rules ahead of static guidance.
`learning-proposals.ts` skips signals whose `notePreview` is present-but-blank
to avoid `Note: —` stubs.

**`agents.agent_threads*` renamed to `operator_threads*`** to disambiguate
from `harness.threads` (the conversation lane). Schema, seeds, services,
handlers, the standalone wake builder, and the operator-chat component all
updated atomically. No data migration — template scaffolding only.

Includes test coverage: `outbound-card.test.ts` (13 cases for WA interactive
shapes, fixture, fields/link-button, truncation, no-footer assertions);
`conv-reassign.test.ts` (4 cases covering happy path, block, staff bypass,
agent-target bypass); `messages.test.ts` extensions for `hasRecentAgentReply`;
`learning-proposals.test.ts` for the empty-note skip; thread test updates
for the rename.

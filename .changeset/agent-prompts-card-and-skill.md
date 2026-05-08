---
"@vobase/template": patch
"create-vobase": patch
---

Strengthen agent prompts for `send_card` and `learned_skill` capture.

**`MERIGPT_INSTRUCTIONS` (`modules/agents/seed.ts`)** — adds two sections derived from realistic-persona smoke findings:

- **Reply format** rule: when the customer has 2+ options to choose, compare, confirm, or act on (plans/pricing, refund decisions, booking slots, lists of choices), prefer `send_card` over `reply`. Cards let the customer one-tap their next move; `reply` is reserved for pure acknowledgements and free-form questions. Surfaces a discipline that was previously only documented per-tool.
- **Product / pricing / plan questions** rule: must `cat /drive/BUSINESS.md` and `cat /drive/pricing.md` before replying. The smoke caught the agent answering plan-comparison questions from memory, sometimes with stale information; this forces grounding in the canonical drive docs and pairs naturally with the new `send_card` rule.

**`learning-candidates-sideload.ts`** — replaces the hedged "rarely the right move" wording for `agents.learned_skill` candidates with a load-bearing rule: treat the candidate body as authoritative, capture verbatim, dismissal requires an explicit reason ("duplicates X" / "contradicted by Y"), replying without acting is wrong. The prior phrasing left enough room for the agent to ignore high-confidence skill candidates entirely — observed in smoke as a reply that consulted an unrelated skill, grep'd for context, then bailed without capturing the lesson.

After both changes the realistic-persona smoke went from 7/10 → 10/10 (with the `redeem-promo` skill captured at `auto_written` from the staff coaching note).

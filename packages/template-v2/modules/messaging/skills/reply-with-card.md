---
name: reply-with-card
description: When to use a rich card instead of plain text for customer replies
tags: [messaging, cards, formatting]
---

# Reply With Card

**Default to `send_card` whenever the reply contains anything the customer can choose, compare, confirm, or act on.** Cards give customers faster tap-reply paths than prose — they reduce typing, reduce round-trips, and are more forgiving on mobile.

Always prefer `send_card` for:

- Any pricing, plan, or quote mention — even a single plan should go out as a card with the price as a field and a CTA button
- Any reply that offers the customer 2+ options (tiers, dates, add-ons, yes/no with consequences)
- Confirmation requests (refunds, cancellations, upgrades) — put the decision on buttons, not a question mark
- How-to steps with a concrete next action (link-button to the setting, or button to trigger it)
- Any list of 3+ items that would otherwise read as bullets in prose

Use plain `reply` only for:

- Pure acknowledgements ("Got it — checking now.")
- Questions back to the customer that require free-form text ("What's the last 4 digits of the card?")
- One-line factual answers with no CTA potential

**When in doubt, card.** A card with one text block and one button is still a better reply than three sentences of prose, because it gives the customer a one-tap next step.

Fallback text is generated automatically via `cardToFallbackText()` — don't worry about channels that can't render cards.

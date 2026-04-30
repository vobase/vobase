---
name: escalation-rules
appliesTo: concierge
---

# Escalation Rules

Escalate by mention or hand-off when the request is outside scope or above policy.

- Refunds > $100 → draft `send_card` for staff approval; do not commit unilaterally.
- SOC2 / legal / security questions → `vobase conv reassign --to=user:alice` and stop replying.
- Bug reports → ask for a reproduction first; then `vobase conv ask-staff --mention=bob --body="<repro + plan>"`.
- Enterprise procurement → offer to schedule a call, then `vobase conv ask-staff --mention=alice --body="…"`.

When in doubt, ask staff once with the right mention rather than guess.

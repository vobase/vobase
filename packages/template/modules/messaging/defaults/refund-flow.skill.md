---
name: refund-flow
appliesTo: conversation
---

# Refund Flow

1. Confirm the customer's order id (`vobase contacts show --id=<id>`).
2. Check `/drive/BUSINESS.md#Policies` for the eligibility window.
3. If within the window AND amount ≤ $100, draft a `confirmation` card with the refund amount + ETA.
4. If amount > $100 OR outside the window, draft the same card but mark it `requires_approval=true` and mention `@billing-lead` in the staff thread.
5. Never confirm a refund verbally before the card is acknowledged.

Always end with the refund ETA in the customer's timezone.

---
"@vobase/template": patch
---

# Staff-notification reply routing — correctness + cross-tenant hardening

Reply-routing fixes and a security review on the shared WhatsApp notification channel.

## Reply routing fixes

- A staff member's WhatsApp reply to an agent's notification now re-engages the right party. The reply note's body is prefixed with the `@handle` of whoever authored the note that triggered the ping — agent or staff — so the body-driven staff-note fan-out actually fires. A bare reply previously set the `mentions` column but woke nobody.
- The operator-thread wake reads the latest *user* message off the thread, not the latest message of any role, so a second back-to-back message is the one the agent sees.
- Agent replies mirrored out the notification channel carry an `[Agent]` prefix so staff can tell them apart from other notification-channel traffic.

## Cross-tenant / cross-user hardening

Security review of the notification paths (one shared number across all tenants):

- The notification-mirror observer resolves the recipient phone fresh per dispatch, re-confirming verified org membership, instead of freezing it at wake start — a mid-wake phone change can no longer leak a reply.
- The `pending_staff_pings` upsert key is org-qualified, and a partial unique index on `outbound_wamid` lets the quote-reply claim rung treat the WAMID as a real key rather than a non-unique hint.
- The inbound staff-phone match is gated on `phone_number_verified`.
- A quote-reply to an already-expired ping now appends an operator-thread system hint instead of silently becoming a fresh agent instruction.

The platform-side counterpart — constraining reply routing to a phone's known `staff_link` set and binding quote-reply WAMIDs to the sender phone — ships in `vobase-platform`.

## Terminology

Scoped "ping" (the WhatsApp staff-notification primitive, any kind) against "mention" (the `@-mention` act): removed the dead `PendingMentionPing*` aliases and corrected UI strings that called all-kind staff pings "mention pings".

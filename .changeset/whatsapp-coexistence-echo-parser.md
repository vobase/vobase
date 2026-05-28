---
"@vobase/core": patch
---

Parse the canonical WhatsApp coexistence echo wire shape (`field: 'smb_message_echoes'` + `message_echoes[]`).

`parseWhatsAppEchoes` only handled the legacy form where echoes appeared inline in `messages[]` with `from === phone_number_id`. Meta's Phase 1 coexistence delivery puts staff-sent (Business App) messages in a separate `smb_message_echoes` change carrying a `message_echoes[]` array — each entry has `from` = the business's own phone and `to` = the customer's WA id. The parser dropped these on the floor, so the downstream echo wiring (role=`'staff'`, no service-window seed, no agent wake, `coexistence_echo` learning signal) never fired for real coexistence numbers.

The parser now accepts both shapes. For the coexistence shape it re-keys `from`→`to` before parsing so the contact upsert lands on the customer, not the business itself. The legacy `messages[]` fallback stays for proxied/managed transports that still surface echoes that way.

Type surface: `WhatsAppWebhookPayload['entry'][].changes[].field` gains `'smb_message_echoes'`, `value` gains optional `message_echoes?: WhatsAppInboundMessage[]`, and `WhatsAppInboundMessage` gains optional `to?: string` (set only on echo entries). All additions are backwards-compatible.

---
name: whatsapp-cloud-api
description: >
  Official WhatsApp Cloud API reference for building messaging integrations.
  Covers Embedded Signup (primary onboarding flow), sending messages (text,
  media, templates, interactive), receiving webhooks, conversation lifecycle,
  phone number management, and error handling. Use when building WhatsApp
  integrations, implementing Embedded Signup, sending messages, processing
  webhooks, or working with the Meta WhatsApp Business Platform API.
license: MIT
metadata:
  author: Bello Sanchez, Vobase
  version: "2.0.0"
  source: "Meta Official Documentation (developers.facebook.com)"
compatibility: "Claude Code, Cursor, Windsurf, GitHub Copilot"
---

# WhatsApp Cloud API

## When to Use

Activate this skill when:
- Implementing WhatsApp Embedded Signup (onboarding businesses to WABA)
- Building or modifying WhatsApp messaging features
- Sending messages (text, media, templates, interactive)
- Processing incoming webhooks from WhatsApp
- Working with template messages or conversation windows
- Handling phone number formatting (E.164)
- Debugging WhatsApp API errors or status updates
- Implementing message status tracking (sent, delivered, read)

## Quick Reference

| Item | Value |
|------|-------|
| **Base URL** | `https://graph.facebook.com/v22.0` |
| **Send Message** | `POST /{phone-number-id}/messages` |
| **Upload Media** | `POST /{phone-number-id}/media` |
| **Auth** | `Authorization: Bearer {access-token}` |
| **Required Field** | `"messaging_product": "whatsapp"` |
| **Phone Format** | E.164: `+{country}{number}` (e.g., `+18091234567`) |
| **Rate Limit** | 80 messages/second (Cloud API) |

## Core API — Send Message

All messages go through a single endpoint:

```
POST https://graph.facebook.com/v22.0/{phone-number-id}/messages
Authorization: Bearer {access-token}
Content-Type: application/json
```

**Response:**
```json
{
  "messaging_product": "whatsapp",
  "contacts": [{ "input": "+16505555555", "wa_id": "16505555555" }],
  "messages": [{ "id": "wamid.HBgL..." }]
}
```

## Message Types

| Type | `type` Field | Details |
|------|-------------|---------|
| Text | `text` | Plain text, max 4096 chars, supports URL preview |
| Image | `image` | JPEG/PNG, max 5MB, optional caption |
| Video | `video` | MP4, max 16MB, optional caption |
| Audio | `audio` | AAC/MP3/OGG, max 16MB |
| Document | `document` | Any format, max 100MB, optional filename |
| Sticker | `sticker` | WebP, static 100KB / animated 500KB |
| Location | `location` | latitude, longitude, name, address |
| Contacts | `contacts` | Structured contact cards |
| Reaction | `reaction` | Emoji reaction to a message |
| Interactive | `interactive` | Buttons, lists, products |
| Template | `template` | Pre-approved message templates |

For full specs and code examples, see [references/messaging.md](references/messaging.md).

## Webhooks

Your server receives POST requests for incoming messages and status updates.

**Incoming message structure:**
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "phone_number_id": "ID", "display_phone_number": "NUM" },
        "contacts": [{ "profile": { "name": "John" }, "wa_id": "16315551234" }],
        "messages": [{
          "from": "16315551234",
          "id": "wamid.ABC...",
          "timestamp": "1683229471",
          "type": "text",
          "text": { "body": "Hello" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

**Status update types:** `sent` → `delivered` → `read` | `failed` | `deleted` | `warning`

For webhook verification, payload parsing, and all status types, see [references/webhooks.md](references/webhooks.md).

## Conversation Window

- When a customer messages you, a **24-hour service window** opens
- The window resets from the customer's **last incoming message** only — your replies do NOT extend it
- Inside the window: send any message type freely (service messages are **FREE**)
- Outside the window: only **template messages** can be sent (paid per message)
- No API endpoint to "close" a conversation — windows expire automatically
- Template messages open their own 24h window per category (marketing, utility, auth)

For full lifecycle, pricing, and category rules, see [references/conversations.md](references/conversations.md).

## Common Patterns

### Send a text message
```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "text",
  "text": { "body": "Hello! How can we help you?" }
}
```

### Send a template message
```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "template",
  "template": {
    "name": "hello_world",
    "language": { "code": "en_US" }
  }
}
```

### Mark a message as read
```json
{
  "messaging_product": "whatsapp",
  "status": "read",
  "message_id": "wamid.HBgL..."
}
```

## Error Handling

| Code | Error | Action |
|------|-------|--------|
| 131026 | Message undeliverable | Verify recipient has WhatsApp and is reachable |
| 131047 | Re-engagement required | Send a template message first |
| 131049 | Meta chose not to deliver | Per-user marketing limit; wait 24h |
| 131050 | User stopped marketing messages | Respect opt-out, do not retry |
| 130429 | Rate limit exceeded | Queue messages, max 80/sec |

For full error reference and retry strategies, see [references/error-codes.md](references/error-codes.md).

## Best Practices

1. **Always use E.164 phone format** — `+{country}{number}`, no spaces or dashes
2. **Verify webhooks** — Respond to GET challenge with `hub.challenge` value
3. **Return 200 immediately** on webhook POST — process asynchronously
4. **Store `wamid` IDs** — Needed for replies, reactions, and read receipts
5. **Use template messages** to re-engage after the 24h window expires
6. **Handle idempotency** — Webhook may deliver the same event multiple times
7. **Check `wa_id` vs input** — The API normalizes phone numbers; `wa_id` is canonical
8. **Rate limit awareness** — 80 msg/sec for Cloud API; implement queue + backoff
9. **Download media immediately** — Incoming media URLs expire in ~5 minutes; a 401 means expiry, not auth failure
10. **Use `context.message_id` for replies** — Without it, recipients see a standalone message instead of a threaded reply
11. **Template parameters must match exactly** — Count, format (positional vs named), and type must match the approved template definition

## References

- [Messaging — All message types](references/messaging.md)
- [Webhooks — Setup and payloads](references/webhooks.md)
- [Templates — Management and sending](references/templates.md)
- [Conversations — Window lifecycle and pricing](references/conversations.md)
- [Media — Upload, download, formats](references/media.md)
- [Interactive — Buttons, lists, products](references/interactive.md)
- [Phone Numbers — E.164, IDs, verification](references/phone-numbers.md)
- [Error Codes — Common errors and retries](references/error-codes.md)
- [Embedded Signup — WhatsApp onboarding flow](references/embedded-signup.md)
- [Coexistence — Business App + Cloud API on same number](references/coexistence.md)
- [Groups — Group chat management API](references/groups.md)
- [Webhook Overrides — Per-WABA and per-phone callback URLs](references/webhook-overrides.md)

## Sources

- [WhatsApp Cloud API — Overview](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [WhatsApp Cloud API — Get Started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [WhatsApp Cloud API — Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference)
- [WhatsApp Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup)
- [WhatsApp Pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- [Graph API v22.0 Changelog](https://developers.facebook.com/docs/graph-api/changelog/version22.0)

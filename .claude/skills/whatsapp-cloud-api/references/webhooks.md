# Webhooks Reference

> **Author:** Bello Sanchez, Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

> Complete reference for WhatsApp Cloud API webhook verification, incoming message
> payloads, status updates, and processing best practices.

---

## Webhook Verification (GET)

When you configure a webhook URL in the Meta App Dashboard, Meta sends a **GET** request
to verify that your server owns the endpoint. Your server must validate the request and
respond correctly for the webhook to be registered.

### Verification Request Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `hub.mode` | `"subscribe"` | Always set to `subscribe` for webhook setup |
| `hub.verify_token` | Your configured token | The token you defined in the App Dashboard |
| `hub.challenge` | Random string | A challenge string that must be returned |

### Verification Flow

1. Meta sends a GET request to your webhook URL with the three query parameters above.
2. Your server compares `hub.verify_token` against your stored verify token.
3. If the tokens match, return the `hub.challenge` value with HTTP status **200**.
4. If the tokens do not match, return HTTP status **403** (Forbidden).

### Implementation Example

```typescript
// GET /webhook
function verifyWebhook(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
}
```

> **Important:** The verify token is a secret you define yourself. It is NOT the same
> as your Graph API access token. Store it securely in environment variables.

---

## Incoming Message Webhook (POST)

When a user sends a message to your WhatsApp Business number, Meta delivers a POST
request to your webhook URL with the full message payload.

### Full Payload Structure

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "16505555555",
              "phone_number_id": "PHONE_NUMBER_ID"
            },
            "contacts": [
              {
                "profile": {
                  "name": "John Doe"
                },
                "wa_id": "16315555555"
              }
            ],
            "messages": [
              {
                "from": "16315555555",
                "id": "wamid.ABC",
                "timestamp": "1683229471",
                "type": "text",
                "text": {
                  "body": "Hello"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### Payload Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `object` | `string` | Always `"whatsapp_business_account"` |
| `entry[].id` | `string` | WhatsApp Business Account ID |
| `entry[].changes[].field` | `string` | Always `"messages"` for message events |
| `value.messaging_product` | `string` | Always `"whatsapp"` |
| `value.metadata.display_phone_number` | `string` | Your business phone number |
| `value.metadata.phone_number_id` | `string` | Phone Number ID used for API calls |
| `value.contacts[].profile.name` | `string` | Sender's WhatsApp profile name |
| `value.contacts[].wa_id` | `string` | Sender's canonical WhatsApp ID (E.164, no `+`) |
| `value.messages[].from` | `string` | Sender's phone number |
| `value.messages[].id` | `string` | Unique message ID (e.g., `wamid.HBgL...`) |
| `value.messages[].timestamp` | `string` | Unix timestamp (seconds) as a string |
| `value.messages[].type` | `string` | Message type (see section below) |

### Extracting the Message

```typescript
function extractMessage(body: WebhookPayload) {
  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  if (!value?.messages?.length) {
    return null; // Not a message event (could be a status update)
  }

  return {
    phoneNumberId: value.metadata.phone_number_id,
    senderName: value.contacts?.[0]?.profile?.name ?? 'Unknown',
    senderPhone: value.messages[0].from,
    messageId: value.messages[0].id,
    timestamp: value.messages[0].timestamp,
    type: value.messages[0].type,
    message: value.messages[0],
  };
}
```

---

## Message Types in Webhooks

Each incoming message has a `type` field. The message content is nested under a key
matching that type name.

### Text Message

```json
{
  "type": "text",
  "text": {
    "body": "Hello, I need help with my order"
  }
}
```

### Image Message

```json
{
  "type": "image",
  "image": {
    "id": "MEDIA_ID",
    "mime_type": "image/jpeg",
    "sha256": "HASH",
    "caption": "Check this out"
  }
}
```

### Video Message

```json
{
  "type": "video",
  "video": {
    "id": "MEDIA_ID",
    "mime_type": "video/mp4"
  }
}
```

### Audio Message

```json
{
  "type": "audio",
  "audio": {
    "id": "MEDIA_ID",
    "mime_type": "audio/ogg; codecs=opus"
  }
}
```

### Document Message

```json
{
  "type": "document",
  "document": {
    "id": "MEDIA_ID",
    "filename": "invoice.pdf",
    "mime_type": "application/pdf"
  }
}
```

### Location Message

```json
{
  "type": "location",
  "location": {
    "latitude": 18.4861,
    "longitude": -69.9312,
    "name": "Santo Domingo",
    "address": "Av. Winston Churchill, Santo Domingo"
  }
}
```

### Contacts Message

```json
{
  "type": "contacts",
  "contacts": [
    {
      "name": { "formatted_name": "Jane Smith", "first_name": "Jane", "last_name": "Smith" },
      "phones": [{ "phone": "+18091234567", "type": "CELL" }],
      "emails": [{ "email": "jane@example.com", "type": "WORK" }]
    }
  ]
}
```

### Sticker Message

```json
{
  "type": "sticker",
  "sticker": {
    "id": "MEDIA_ID",
    "mime_type": "image/webp",
    "sha256": "HASH",
    "animated": false
  }
}
```

> **Note:** Static stickers are max 100KB, animated stickers max 500KB.

### Reaction Message

```json
{
  "type": "reaction",
  "reaction": {
    "message_id": "wamid.HBgL...",
    "emoji": "\ud83d\udc4d"
  }
}
```

> **Edge case:** When a user removes their reaction, `emoji` is an empty string — not
> `null` or absent. Handle both adding and removing reactions.

### Interactive Message (Reply)

**Button Reply:**

```json
{
  "type": "interactive",
  "interactive": {
    "type": "button_reply",
    "button_reply": {
      "id": "btn_yes",
      "title": "Yes"
    }
  }
}
```

**List Reply:**

```json
{
  "type": "interactive",
  "interactive": {
    "type": "list_reply",
    "list_reply": {
      "id": "option_1",
      "title": "Option 1",
      "description": "First option description"
    }
  }
}
```

### Button Message (Quick Reply from Template)

When a user taps a quick reply button on a **template message**, the response arrives
as a `button` type (not `interactive`).

```json
{
  "type": "button",
  "button": {
    "text": "Yes, confirm",
    "payload": "CONFIRM_ORDER_123"
  }
}
```

> **Note:** `button` (template quick replies) and `interactive.button_reply` (interactive
> message buttons) are different types. Handle them separately.

---

## Status Update Webhooks

Status updates are delivered to the same webhook endpoint as incoming messages. They
appear in the `statuses` array instead of the `messages` array.

### Status Lifecycle

```
sent → delivered → read
                 ↘ failed
```

### Status Payload Structure

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "16505555555",
              "phone_number_id": "PHONE_NUMBER_ID"
            },
            "statuses": [
              {
                "id": "wamid.XXX",
                "status": "delivered",
                "timestamp": "1638420000",
                "recipient_id": "16315551234",
                "conversation": {
                  "id": "CONV_ID",
                  "origin": {
                    "type": "business_initiated"
                  }
                },
                "pricing": {
                  "billable": true,
                  "pricing_model": "CBP",
                  "category": "marketing"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### Status Values

| Status | Description |
|--------|-------------|
| `sent` | Message accepted by the WhatsApp server |
| `delivered` | Message delivered to the recipient's device |
| `read` | Recipient opened and viewed the message |
| `failed` | Message could not be delivered (see `errors` array for details) |
| `deleted` | Customer deleted their copy of the message (no `errors` array) |
| `warning` | Non-fatal issue occurred (see `errors` array — message may still deliver) |

> **Edge cases:**
> - Status updates may arrive **out of order** — a `read` can arrive before `delivered`. Use timestamps.
> - A webhook may contain **only** `statuses` (no `messages`) — check both arrays.
> - `deleted` and `warning` statuses don't follow the `sent→delivered→read` lifecycle.
> - The `errors` array is present on `failed` and `warning` statuses but NOT on `deleted`.

### Failed Status — Error Details

```json
{
  "statuses": [
    {
      "id": "wamid.XXX",
      "status": "failed",
      "timestamp": "1638420000",
      "recipient_id": "16315551234",
      "errors": [
        {
          "code": 131047,
          "title": "Re-engagement message",
          "message": "More than 24 hours have passed since the recipient last replied.",
          "error_data": {
            "details": "Recipient must message you first or use a template."
          }
        }
      ]
    }
  ]
}
```

### Distinguishing Messages from Statuses

```typescript
function handleWebhook(body: WebhookPayload): void {
  const value = body.entry?.[0]?.changes?.[0]?.value;

  if (value?.messages?.length) {
    handleIncomingMessage(value);
  } else if (value?.statuses?.length) {
    handleStatusUpdate(value);
  }
}
```

---

## Best Practices

### 1. Return 200 Immediately, Process Asynchronously

```typescript
app.post('/webhook', (req, res) => {
  res.status(200).send('OK');
  processWebhookAsync(req.body);
});
```

### 2. Handle Duplicate Deliveries (Idempotency)

Use the message ID (`wamid`) as an idempotency key.

### 3. Check Timestamps for Ordering

Webhook notifications may arrive out of order. Use `timestamp` for correct sequencing.

### 4. Validate the Payload Signature

```typescript
import crypto from 'crypto';

function verifySignature(payload: string, signature: string, appSecret: string): boolean {
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');
  return `sha256=${expected}` === signature;
}
```

### 5. Handle All Message Types

Design your webhook handler to gracefully process every message type.

---

## Additional Webhook Fields

Beyond `messages`, Meta sends webhooks on several other fields:

| Webhook Field | Purpose |
|---------------|---------|
| `messages` | Incoming messages AND status updates (most common) |
| `message_template_status_update` | Template approval/rejection/pause notifications |
| `account_update` | WABA or phone number status changes |
| `phone_number_quality_update` | Quality rating changes |
| `user_preferences` | User opts out of or resumes marketing messages |

## Skippable Message Types

Some incoming message types should be acknowledged but not processed as content:

| Type | Meaning | Action |
|------|---------|--------|
| `ephemeral` | Disappearing message notification | Ignore — no content to process |
| `request_welcome` | User requested welcome message | Trigger your welcome flow, no content |
| `unsupported` | Client sent unsupported type | Log the error; `errors` array has details |

The `unsupported` and `errors` types share the same structure:

```json
{
  "type": "unsupported",
  "errors": [{
    "code": 131051,
    "title": "Unsupported message type",
    "details": "Message type is not currently supported"
  }]
}
```

## Status Edge Cases

**`pending` status** — Some implementations receive `pending` instead of `sent`. Treat `pending` as equivalent to `sent`.

**`failed` → `sent` transition** — A message that initially failed can later succeed (retry). This is the one valid "backwards" status transition. Allow `failed` → `sent` → `delivered` → `read`.

**SMB Message Echoes** — Messages sent from the WhatsApp Business App (not your API) arrive on a separate webhook field `smb_message_echoes` with a different payload structure. These represent outgoing messages your staff sent manually.

---

## Common Gotchas (From Production Experience)

1. **`button` vs `interactive.button_reply` are different types.** Template quick reply buttons arrive as `type: "button"`. Interactive message buttons arrive as `type: "interactive"`.

2. **Webhook payloads can be batched.** A single POST may contain multiple entries. Always iterate all levels.

3. **Media URLs expire in ~5 minutes.** Download media immediately using the Media API. A 401 on download usually means URL expiry, not an auth problem.

4. **The `contacts` array maps `wa_id` to profile names.** Use this to look up display names.

5. **Outbound message echoes can trigger webhook events.** Track sent `wamid` IDs to distinguish outbound from inbound.

6. **Text messages are limited to 4096 characters.** Split longer texts before sending.

7. **`object` field validation.** Verify `object === "whatsapp_business_account"` before processing.

8. **Graph API error responses are JSON, not plain text.** Always parse `{ error: { code, message, error_data, fbtrace_id } }`. Note: `error_subcode` is deprecated since v16.0+.

9. **Brazil phone number normalization.** Brazilian mobile numbers may arrive with or without the 9th digit (after country code `55`). Store the canonical `wa_id` to avoid duplicate contacts.

10. **Reply context is in `context.id`, not `context.message_id`.** Incoming messages that are replies include `context: { id: "wamid..." }` — use this to thread conversations.

---

## Sources

- [WhatsApp Cloud API — Webhooks: Get Started](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components)
- [WhatsApp Cloud API — Webhook Payload Examples](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples)
- [WhatsApp Cloud API — Webhook Notification Payloads](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/webhook-payloads)

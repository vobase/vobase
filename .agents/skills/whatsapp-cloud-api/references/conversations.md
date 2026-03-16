# WhatsApp Cloud API - Conversations & Pricing

> **Author:** Bello Sanchez, Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## Customer Service Window

- Opens when a customer sends **you** a message.
- Lasts **24 hours** from the customer's **last incoming message**.
- **Inside the window:** send any message type freely (text, media, interactive, etc.).
- **Outside the window:** only **template messages** can be sent.

> **Gotcha:** Only **incoming** messages from the customer reset the 24-hour window. Your outgoing replies do NOT extend it. If the customer messages at hour 0, you have until hour 24 — regardless of when you reply.

## Conversation Categories & Pricing

| Category         | Opened By                                      | Duration | Cost                |
| ---------------- | ---------------------------------------------- | -------- | ------------------- |
| **Service**      | Non-template message (when window is active)   | 24h      | FREE                |
| **Marketing**    | Marketing template                             | 24h      | Paid per message    |
| **Utility**      | Utility template                               | 24h      | Paid per message    |
| **Authentication** | Authentication template                      | 24h      | Paid per message    |

## How Conversations Open

- **Marketing / Utility / Authentication:** Opens when you send a template and no open conversation of that same category exists.
- **Service:** Opens when you send a non-template message and no open conversation of **any** category exists.

## Key Rules

1. Multiple conversations of **different** categories can be open simultaneously.
2. Sending a template inside an open conversation of the **same** category does **not** open a new one.
3. Service conversations only open if **no** conversation of any category is currently open.
4. There is **no** API endpoint to manually close a conversation -- they expire automatically after 24 hours.
5. Per-message pricing replaced conversation-based pricing on **July 1, 2025**.
6. On-Premises API was sunset on **October 23, 2025** -- only Cloud API remains.

## Free Entry Points

- A **72-hour free window** opens when a customer clicks a Click-to-WhatsApp ad or a CTA button.
- During this window, service conversations are **free**.
- Template messages sent during this window open **free** conversations of their respective category.

## Pricing Webhook Data

Status webhooks include pricing information in the payload:

```json
{
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
```

Use the `pricing.billable` field to determine if a conversation is being charged, and `pricing.category` to identify the billing category.

---

## Sources

- [WhatsApp Cloud API — Conversations and Pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- [WhatsApp Cloud API — Conversation Categories](https://developers.facebook.com/docs/whatsapp/pricing#conversations)

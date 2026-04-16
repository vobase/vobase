# WhatsApp Cloud API - Message Templates

> **Author:** Bello Sanchez, Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## Template Categories

| Category           | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| **Marketing**      | Promotions, offers, product announcements                  |
| **Utility**        | Order confirmations, shipping updates, account notifications |
| **Authentication** | OTP codes, verification                                    |

## Template Lifecycle

```
PENDING → APPROVED → REJECTED (or DISABLED)
```

- Templates must be submitted for review before use.
- Meta reviews templates and either approves or rejects them.
- Approved templates can later be disabled by Meta if they violate policies.

## Creating Templates

**Endpoint:** `POST /{WABA_ID}/message_templates`

```json
{
  "name": "order_confirmation",
  "language": "en_US",
  "category": "utility",
  "components": [
    {
      "type": "header",
      "format": "text",
      "text": "Order {{1}}"
    },
    {
      "type": "body",
      "text": "Hi {{1}}, your order #{{2}} has been confirmed. Total: ${{3}}"
    },
    {
      "type": "footer",
      "text": "Thank you for your purchase"
    },
    {
      "type": "buttons",
      "buttons": [
        {
          "type": "URL",
          "text": "Track Order",
          "url": "https://example.com/track/{{1}}"
        }
      ]
    }
  ]
}
```

## Sending Templates

**Endpoint:** `POST /{phone-number-id}/messages`

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "template",
  "template": {
    "name": "order_confirmation",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "header",
        "parameters": [
          { "type": "text", "text": "ORD-12345" }
        ]
      },
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "John" },
          { "type": "text", "text": "ORD-12345" },
          { "type": "text", "text": "49.99" }
        ]
      },
      {
        "type": "button",
        "sub_type": "url",
        "index": 0,
        "parameters": [
          { "type": "text", "text": "ORD-12345" }
        ]
      }
    ]
  }
}
```

## Header Types

| Format       | Description                                              |
| ------------ | -------------------------------------------------------- |
| `text`       | Plain text header with optional variable placeholders    |
| `image`      | Image header (requires media ID or link in parameters)   |
| `video`      | Video header (requires media ID or link in parameters)   |
| `document`   | Document header (requires media ID or link in parameters)|

## Button Types in Templates

| Type             | Behavior                                                    |
| ---------------- | ----------------------------------------------------------- |
| `URL`            | Opens a URL with an optional dynamic suffix                 |
| `PHONE_NUMBER`   | Initiates a phone call to the specified number              |
| `QUICK_REPLY`    | Returns a button payload in the webhook when tapped         |
| `COPY_CODE`      | Copies a code to the clipboard (e.g., coupon codes)         |
| `OTP`            | Delivers a one-time password (authentication templates only)|

## Parameter Types

### Text Parameters

The most common type. Positional (`{{1}}`, `{{2}}`) or named (`{{name}}`, `{{email}}`).

```json
{ "type": "text", "text": "John" }
```

### Currency Parameters

Amount is specified in **thousandths** of the currency unit, not the actual amount.

```json
{
  "type": "currency",
  "currency": {
    "fallback_value": "$5.00",
    "code": "USD",
    "amount_1000": 5000
  }
}
```

> **Gotcha:** `amount_1000: 5000` means $5.00, NOT $5,000. The field name is misleading.

### DateTime Parameters

Date/time is specified as individual components, NOT ISO 8601 format.

```json
{
  "type": "date_time",
  "date_time": {
    "fallback_value": "March 15, 2026",
    "day_of_week": 7,
    "day_of_month": 15,
    "year": 2026,
    "month": 3,
    "hour": 14,
    "minute": 0
  }
}
```

### Media Parameters (Header)

For templates with image/video/document headers:

```json
{
  "type": "image",
  "image": { "id": "MEDIA_ID" }
}
```

Or by link:

```json
{
  "type": "image",
  "image": { "link": "https://example.com/image.jpg" }
}
```

> **Gotcha:** Media ID is opaque — you cannot infer the media type (image/video/document) from the ID itself. Always use the format declared in the template header definition.

## Button Parameters When Sending

Each button type requires a different `sub_type` when sending:

| Template Button Type | Send `sub_type` | Parameter | Notes |
|---------------------|-----------------|-----------|-------|
| `URL` (dynamic)     | `url`           | Dynamic URL suffix | URL must include `{{1}}` placeholder |
| `QUICK_REPLY`       | `quick_reply`   | Payload string | Returned in webhook on tap |
| `COPY_CODE`         | `copy_code`     | Code string | Copied to clipboard |
| `OTP`               | —               | OTP code | Auto-fill button |

```json
{
  "type": "button",
  "sub_type": "url",
  "index": 0,
  "parameters": [
    { "type": "text", "text": "order-12345" }
  ]
}
```

> **Gotcha:** For dynamic URL buttons, the template URL must include a `{{1}}` placeholder. The parameter provides only the dynamic suffix, not the full URL.

## Common Pitfalls

1. **Parameter count must match exactly.** If the template has 3 body variables, you must send exactly 3 parameters. Error `132000`.
2. **Variable samples cannot contain** newlines (`\n`, `\r`) or special characters (`#`, `$`, `%`) during template creation.
3. **Template names are case-sensitive** and must match exactly what was approved.
4. **Language code must match** the approved translation (e.g., `en_US` not `en`).
5. **Marketing templates blocked for US numbers** (+1 prefix) since April 2025. Utility and service messages still work.
6. **Authentication templates not supported for India (+91)** — Sending auth templates to Indian numbers returns error `131026`. Use utility templates for OTP delivery in India instead.
7. **Per-user marketing limits** — Meta may withhold delivery to users who don't engage. Error `131049`.
7. **Template max limit** — A WABA can have up to 250 message templates.

---

## Sources

- [WhatsApp Cloud API — Message Templates](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates)
- [WhatsApp Business Management API — Message Templates](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates)

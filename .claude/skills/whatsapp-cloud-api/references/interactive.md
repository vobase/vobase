# WhatsApp Cloud API - Interactive Messages Reference

> **Author:** Bello Sanchez, Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## Overview

Interactive messages allow businesses to present structured choices to users — buttons, lists, CTAs, and product catalogs. They are sent through the same messages endpoint with `type` set to `"interactive"`.

---

## Endpoint

```
POST https://graph.facebook.com/v22.0/{phone-number-id}/messages
```

Every interactive message request body **must** include:

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "interactive",
  "interactive": { ... }
}
```

---

## Interactive Types Summary

| Type            | Description                              | Max Items         |
|-----------------|------------------------------------------|--------------------|
| `button`        | Reply buttons displayed inline           | 3 buttons          |
| `list`          | Scrollable list with sections and rows   | 10 sections, 10 rows per section |
| `cta_url`       | Call-to-action URL button                | 1 URL              |
| `product`       | Single product from a catalog            | 1 product          |
| `product_list`  | Multi-product list from a catalog        | 10 sections, 30 products total |

---

## Reply Buttons

Displays up to 3 inline buttons. Ideal for yes/no choices, confirmations, or simple branching.

### Constraints

| Field              | Limit                |
|--------------------|----------------------|
| Number of buttons  | Max 3                |
| Button title       | Max 20 characters    |
| Button ID          | Max 256 characters   |
| Body text          | Max 1024 characters  |
| Header text        | Max 60 characters    |
| Footer text        | Max 60 characters    |

### Request Body

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "header": {
      "type": "text",
      "text": "Appointment Confirmation"
    },
    "body": {
      "text": "Your appointment is scheduled for March 15 at 2:00 PM. Would you like to confirm?"
    },
    "footer": {
      "text": "Reply to manage your booking"
    },
    "action": {
      "buttons": [
        {
          "type": "reply",
          "reply": { "id": "btn_confirm", "title": "Confirm" }
        },
        {
          "type": "reply",
          "reply": { "id": "btn_reschedule", "title": "Reschedule" }
        },
        {
          "type": "reply",
          "reply": { "id": "btn_cancel", "title": "Cancel" }
        }
      ]
    }
  }
}
```

### Optional Header Types

| Type       | Fields Required                |
|------------|--------------------------------|
| `text`     | `text` (string)                |
| `image`    | `link` or `id`                 |
| `video`    | `link` or `id`                 |
| `document` | `link` or `id`, `filename`     |

### Webhook Response (Button Click)

```json
{
  "type": "interactive",
  "interactive": {
    "type": "button_reply",
    "button_reply": { "id": "btn_confirm", "title": "Confirm" }
  }
}
```

---

## List Messages

Displays a scrollable list of options organized into sections. Ideal for menus or selections with more than 3 options.

### Constraints

| Field                | Limit                |
|----------------------|----------------------|
| Number of sections   | Max 10               |
| Rows per section     | Max 10               |
| Total rows           | Max 10 (across all sections) |
| Button text          | Max 20 characters    |
| Section title        | Max 24 characters    |
| Row title            | Max 24 characters    |
| Row description      | Max 72 characters    |
| Row ID               | Max 200 characters   |

### Request Body

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "interactive",
  "interactive": {
    "type": "list",
    "header": { "type": "text", "text": "Our Services" },
    "body": { "text": "Browse our available services and select one to learn more." },
    "footer": { "text": "Tap the button below to view options" },
    "action": {
      "button": "View Services",
      "sections": [
        {
          "title": "Consulting",
          "rows": [
            { "id": "svc_strategy", "title": "Strategy Session", "description": "1-hour business strategy consultation" },
            { "id": "svc_audit", "title": "Technical Audit", "description": "Full-stack architecture review" }
          ]
        },
        {
          "title": "Development",
          "rows": [
            { "id": "svc_mvp", "title": "MVP Build", "description": "Rapid prototype in 4 weeks" },
            { "id": "svc_custom", "title": "Custom Project", "description": "Tailored software development" }
          ]
        }
      ]
    }
  }
}
```

### Webhook Response (List Selection)

```json
{
  "type": "interactive",
  "interactive": {
    "type": "list_reply",
    "list_reply": { "id": "svc_strategy", "title": "Strategy Session", "description": "1-hour business strategy consultation" }
  }
}
```

---

## CTA URL Button

Displays a single call-to-action button that opens a URL when tapped.

### Request Body

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "interactive",
  "interactive": {
    "type": "cta_url",
    "header": { "type": "text", "text": "Your Order is Ready" },
    "body": { "text": "Track your order status and estimated delivery time on our portal." },
    "footer": { "text": "Order #12345" },
    "action": {
      "name": "cta_url",
      "parameters": {
        "display_text": "Track Order",
        "url": "https://example.com/orders/12345"
      }
    }
  }
}
```

> **Note:** CTA URL buttons do not generate a webhook callback.

---

## Single Product Message

Displays a single product from a linked product catalog.

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "interactive",
  "interactive": {
    "type": "product",
    "body": { "text": "Check out this item we think you'll love." },
    "footer": { "text": "Free shipping on orders over $50" },
    "action": {
      "catalog_id": "CATALOG_ID",
      "product_retailer_id": "SKU-12345"
    }
  }
}
```

---

## Multi-Product Message

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "interactive",
  "interactive": {
    "type": "product_list",
    "header": { "type": "text", "text": "Featured Products" },
    "body": { "text": "Browse our top picks for this week." },
    "action": {
      "catalog_id": "CATALOG_ID",
      "sections": [
        {
          "title": "Electronics",
          "product_items": [
            { "product_retailer_id": "SKU-001" },
            { "product_retailer_id": "SKU-002" }
          ]
        }
      ]
    }
  }
}
```

---

## Best Practices

1. **Use reply buttons for 2-3 options.** Highest engagement rate.
2. **Use lists for 4-10 options.** Keeps conversation clean.
3. **Keep button and row titles short.** Users scan quickly.
4. **Use unique, descriptive IDs.** Make them meaningful for routing (e.g., `btn_confirm_appt`, not `btn_1`).
5. **Always include body text.** Provides essential context.
6. **Test on actual devices.** Rendering varies between iOS and Android.

---

## Sources

- [WhatsApp Cloud API — Interactive Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-messages)
- [WhatsApp Cloud API — Interactive Message Objects](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#interactive-object)

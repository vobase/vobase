# Webhook Callback URL Overrides

> **API Version:** v22.0+
> **Last Updated:** 2026-04-13

> Override the default app-level webhook callback URL at the WABA or phone number level.
> Essential for multi-tenant platforms sharing a single Meta app.

---

## Resolution Order

When a webhook is triggered, Meta checks for an alternate callback URL in this order:

1. **Phone number** override → checked first
2. **WABA** override → checked second
3. **App-level default** → fallback (configured in Meta App Dashboard)

## Supported Webhook Fields

Overrides apply **only** to these webhook field types:

- `messages`
- `message_echoes`
- `calls`
- `consumer_profile`
- `messaging_handovers`
- `group_lifecycle_update`
- `group_participants_update`
- `group_settings_update`
- `group_status_update`
- `smb_message_echoes`
- `smb_app_state_sync`
- `history`
- `account_settings_update`

**Not supported** (always delivered to app default):
- `message_template_status_update`, `message_template_quality_update`, `message_template_components_update`, `template_category_update`
- `account_update`, `account_review_update`, `account_alerts`

---

## Requirements

Before setting an alternate callback URL:

1. Your app must be **subscribed to webhooks on the WABA** (`POST /{WABA_ID}/subscribed_apps`)
2. Your alternate callback endpoint must be able to **receive and process webhooks** (including the verification GET challenge)

---

## WABA-Level Override

### Set WABA Alternate Callback

Set an override by including `override_callback_uri` in the subscribe call:

```
POST /{WABA_ID}/subscribed_apps
Authorization: Bearer {USER_ACCESS_TOKEN}
Content-Type: application/json

{
  "override_callback_uri": "https://example.com/webhook",
  "verify_token": "my-verify-token"
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `override_callback_uri` | Yes | Alternate callback URL (max 200 chars) |
| `verify_token` | Yes | Verification token for the alternate endpoint |

**Response:**
```json
{ "success": true }
```

### Get WABA Alternate Callback

```
GET /{WABA_ID}/subscribed_apps
Authorization: Bearer {USER_ACCESS_TOKEN}
```

**Response:**
```json
{
  "data": [
    {
      "whatsapp_business_api_data": {
        "id": "670843887433847",
        "link": "https://www.facebook.com/games/?app_id=67084...",
        "name": "My App"
      },
      "override_callback_uri": "https://example.com/webhook"
    }
  ]
}
```

### Delete WABA Alternate Callback

Call `POST /{WABA_ID}/subscribed_apps` **without** any body parameters. This removes the override and webhooks fall back to the app default.

```
POST /{WABA_ID}/subscribed_apps
Authorization: Bearer {USER_ACCESS_TOKEN}
```

---

## Phone Number-Level Override

### Set Phone Number Alternate Callback

```
POST /{BUSINESS_PHONE_NUMBER_ID}
Authorization: Bearer {USER_ACCESS_TOKEN}
Content-Type: application/json

{
  "webhook_configuration": {
    "override_callback_uri": "https://example.com/phone-webhook",
    "verify_token": "my-verify-token"
  }
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `webhook_configuration.override_callback_uri` | Yes | Alternate callback URL (max 200 chars) |
| `webhook_configuration.verify_token` | Yes | Verification token for the alternate endpoint |

**Response:**
```json
{ "success": true }
```

### Get Phone Number Alternate Callback

```
GET /{BUSINESS_PHONE_NUMBER_ID}?fields=webhook_configuration
Authorization: Bearer {USER_ACCESS_TOKEN}
```

**Response:**
```json
{
  "webhook_configuration": {
    "phone_number": "https://example.com/phone-webhook",
    "whatsapp_business_account": "https://example.com/waba-webhook",
    "application": "https://example.com/app-webhook"
  },
  "id": "106540352242922"
}
```

> `whatsapp_business_account` is only included if the WABA also has an override set.

### Delete Phone Number Alternate Callback

```
POST /{BUSINESS_PHONE_NUMBER_ID}
Authorization: Bearer {USER_ACCESS_TOKEN}
Content-Type: application/json

{
  "webhook_configuration": {
    "override_callback_uri": ""
  }
}
```

---

## Common Errors

| Code | Subcode | Meaning | Fix |
|------|---------|---------|-----|
| 100 | — | Cannot override callback URI before subscribing | Call `POST /{WABA_ID}/subscribed_apps` first |

---

## Multi-Tenant Architecture Pattern

For platforms sharing a single Meta app across multiple tenants:

```
WABA A → override → tenant-a.example.com/webhook
WABA B → override → tenant-b.example.com/webhook
WABA C → (no override) → app default callback
```

Use `override_callback_uri` in the `POST /{WABA_ID}/subscribed_apps` call during Embedded Signup to route each WABA's webhooks to the correct tenant. This avoids the destructive pattern of overwriting the app-level callback URL (`POST /{APP_ID}/subscriptions`) on every signup.

---

## Sources

- [WhatsApp Webhook Overrides](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override)

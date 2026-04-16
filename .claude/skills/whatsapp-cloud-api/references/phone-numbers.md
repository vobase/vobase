# WhatsApp Cloud API - Phone Numbers Reference

> **Author:** Bello Sanchez, Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## E.164 Format (Required for Sending)

```
+{country_code}{subscriber_number}
```

- Must start with `+` followed by the country code.
- No spaces, dashes, parentheses, or other formatting.

### Examples

| Country              | E.164 Format     |
|----------------------|------------------|
| Dominican Republic   | +18091234567     |
| United States        | +16505551234     |
| Mexico (mobile)      | +5215551234567   |
| Spain                | +34612345678     |
| Brazil               | +5511912345678   |

---

## Phone Number Identifiers

| Field                  | Format             | Example            | Where Used                        |
|------------------------|--------------------|--------------------|-----------------------------------|
| `phone_number_id`      | Numeric string     | `"106540352242922"` | API endpoint paths (sending)     |
| `display_phone_number` | E.164 with `+`     | `"+16505555555"`   | Meta Business Manager display     |
| `wa_id`                | Digits only (no +) | `"18091234567"`    | Webhook payloads, API responses   |

### Key Distinctions

- **`phone_number_id`**: Internal Meta identifier. Used in API paths. NOT the phone number itself.
- **`display_phone_number`**: Human-readable business phone number with `+` prefix.
- **`wa_id`**: Canonical WhatsApp identifier. Always digits only, never includes `+`.

### Normalization Behavior

| Input Sent          | Returned `wa_id`  |
|---------------------|--------------------|
| `+1 (809) 123-4567` | `18091234567`     |
| `+1-809-123-4567`   | `18091234567`     |
| `18091234567`        | `18091234567`     |
| `+18091234567`       | `18091234567`     |

> **Important:** Always store `wa_id` (digits only) as the canonical customer identifier.

---

## Phone Number Registration

### Registration Endpoint

```
POST https://graph.facebook.com/v22.0/{phone-number-id}/register
```

```json
{
  "messaging_product": "whatsapp",
  "pin": "123456"
}
```

| Field                | Type   | Required | Description                            |
|----------------------|--------|----------|----------------------------------------|
| `messaging_product`  | string | Yes      | Must be `"whatsapp"`.                  |
| `pin`                | string | Yes      | 6-digit two-step verification PIN.     |

---

## Two-Step Verification

### Set or Update PIN

```
POST https://graph.facebook.com/v22.0/{phone-number-id}
```

```json
{
  "pin": "123456"
}
```

---

## Retrieving Phone Number Details

### Get a Specific Phone Number

```
GET https://graph.facebook.com/v22.0/{phone-number-id}
```

**Response:**

```json
{
  "id": "106540352242922",
  "display_phone_number": "+16505555555",
  "verified_name": "My Business",
  "quality_rating": "GREEN",
  "messaging_limit": "TIER_2",
  "platform_type": "CLOUD_API",
  "code_verification_status": "VERIFIED"
}
```

### List All Phone Numbers for a WABA

```
GET https://graph.facebook.com/v22.0/{waba-id}/phone_numbers
```

---

## Best Practices

1. **Always store `wa_id` as the canonical identifier.**
2. **Normalize before comparing.** Strip non-digit characters and compare digit strings.
3. **Validate E.164 format before sending.** Reject numbers not matching `^\+[1-9]\d{1,14}$`.
4. **Never hardcode `phone_number_id`.** Store in environment variables.
5. **Monitor quality rating.** A drop to RED limits messaging capacity.
6. **Use two-step verification.** Prevents unauthorized re-registration.

---

## Sources

- [WhatsApp Cloud API — Phone Numbers](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers)
- [WhatsApp Cloud API — Phone Number Registration](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/add-a-phone-number)
- [WhatsApp Cloud API — Two-Step Verification](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/two-step-verification)

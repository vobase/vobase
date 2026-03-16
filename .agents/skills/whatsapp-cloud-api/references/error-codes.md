# WhatsApp Cloud API - Error Codes Reference

> **Author:** Bello Sanchez, Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## Error Response Format

```json
{
  "error": {
    "message": "(#130429) Rate limit hit",
    "type": "OAuthException",
    "code": 130429,
    "error_data": {
      "messaging_product": "whatsapp",
      "details": "Cloud API message throughput has been reached."
    },
    "fbtrace_id": "Az8or2yhqkZfEZ-_4Qn_Bam"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `code` | integer | Primary error code. Build error handling around this. |
| `message` | string | Combination of error code and title (e.g., `(#130429) Rate limit hit`). |
| `details` | string | Description of the error and possible resolution. |
| `fbtrace_id` | string | Trace ID for Meta support debugging. Always log this. |
| `type` | string | Error type (e.g., `OAuthException`). |

> **Note:** `error_subcode` is deprecated since v16.0+ and will not be returned. Build error handling around `code` and `details` instead.

---

## Common Error Codes

### Message Delivery Errors

| Code   | Title                           | Cause                                           | Resolution                                    |
|--------|----------------------------------|--------------------------------------------------|-----------------------------------------------|
| 131026 | Message Undeliverable            | "Bucket error" — see detailed causes below. | Investigate the specific cause (see 131026 section). |
| 131047 | Re-engagement message            | 24-hour customer service window has expired.    | Send an approved template message. Do NOT retry. |
| 131049 | Meta chose not to deliver        | Per-user marketing template limit reached.      | Wait 24h before resending. See Per-User Marketing Limits. |
| 131050 | User stopped marketing messages  | User opted out of marketing-category messages.  | Do not retry. Subscribe to `user_preferences` webhook. |
| 131051 | Unsupported message type         | The `type` field value is not recognized.       | Verify the `type` field spelling. |

### Rate Limit Errors

| Code   | Title                        | Resolution                                       |
|--------|------------------------------|--------------------------------------------------|
| 130429 | Rate limit hit               | Cloud API throughput reached. Queue messages, retry with exponential backoff. |
| 131048 | Spam rate limit hit          | Too many messages blocked/flagged as spam. Check quality status in WhatsApp Manager. |
| 131056 | Pair rate limit exceeded     | Too many messages to same recipient. Wait 60s before retrying to same number. |
| 130472 | User part of experiment      | Message withheld by Meta marketing experiment. See Marketing Message Experiment docs. |

### Template Errors

| Code   | Title                              | Resolution                                       |
|--------|------------------------------------|--------------------------------------------------|
| 132000 | Template parameter count mismatch  | Verify parameter count matches template definition. |
| 132001 | Template does not exist            | Verify template name and `language.code` are correct and approved. |
| 132005 | Template hydrated text too long    | Reduce parameter values length. |
| 132012 | Template parameter format mismatch | Variable parameter values formatted incorrectly. Check format. |
| 132015 | Template paused                    | Fix template quality or create a new template. |
| 132068 | Flow is in blocked state           | Fix the Flow in Business Manager. |

### Registration and Authentication Errors

| Code   | Title                       | Resolution                                        |
|--------|-----------------------------|---------------------------------------------------|
| 131042 | Business eligibility payment issue | Payment method missing, credit line over limit, or WABA suspended. **72-hour cooling period** — see below. |
| 133010 | Phone number not registered | Complete phone number registration. |
| 131031 | Account has been locked     | Account restricted for policy violation or incorrect two-step PIN. See Policy Enforcement. |
| 100    | Invalid parameter           | Check request body against API specification. |
| 190    | Access token expired        | Get a new access token. |

---

## Error 131026 — Message Undeliverable (Detail)

This is a **"bucket error"** — WhatsApp groups multiple distinct failure reasons under this single code. Investigation is required to identify the specific cause.

**Meta-documented causes:**

1. **Recipient not a WhatsApp number** — Phone number not registered on WhatsApp. Common with recycled telco numbers.
2. **Recipient hasn't accepted latest ToS** — WhatsApp blocks all inbound business messages until the user accepts.
3. **Recipient using outdated WhatsApp version** — Minimum versions: Android 2.21.15.15, iOS 2.21.170.4, KaiOS 2.2130.10, Web 2.2132.6.
4. **Authentication templates to Indian (+91) numbers** — Meta does not support authentication templates for Indian phone numbers. Use utility templates for OTP in India instead.

**Common real-world causes:**

5. **User blocked your business number** — Returns 131026, not a separate code. You cannot message this user until they unblock you.
6. **24-hour window expired** — Sending a session message outside the window. Use a template message instead.
7. **Template mismatch** — Template name, language code, or parameter count doesn't match the approved template.
8. **Number migration or coexistence issues** — Incomplete migration or coexistence setup.

> **Debugging tip:** Check the `error.error_data.details` field in the API response — it often contains the specific sub-reason.

---

## Error 131042 — Payment Issue (72-Hour Block)

When this error occurs, WhatsApp enforces a **72-hour cooling period**:

- Do **NOT** retry more than 10 times — excessive retries can extend the block or make it permanent
- Wait the full 72 hours before attempting to send messages again
- During the cooling period, verify your payment method in Meta Business Suite

**Common causes:**
- Payment account not attached to the WABA
- Credit line over limit or not active
- WABA deleted or suspended
- Currency or timezone not set on the WABA

---

## Rate Limits

| Limit Type               | Value                                   |
|--------------------------|-----------------------------------------|
| Messages per second      | 80 per phone number                     |
| Media uploads per second | Subject to general Graph API rate limits |

---

## Quality Rating

| Rating          | Indicator | Impact                                           |
|-----------------|-----------|--------------------------------------------------|
| High            | GREEN     | Eligible for tier upgrades. |
| Medium          | YELLOW    | Quality declining. Watch closely. |
| Low             | RED       | Tier may decrease. Templates may be paused. |

---

## Messaging Tiers

| Tier   | Unique Customers per 24 Hours |
|--------|-------------------------------|
| Tier 1 | 1,000                         |
| Tier 2 | 10,000                        |
| Tier 3 | 100,000                       |
| Tier 4 | Unlimited                     |

---

## Retry Strategy

### Retryable Errors

| Error Code | Retry Strategy                                                        |
|------------|-----------------------------------------------------------------------|
| 130429     | Exponential backoff starting at 1s, max 60s. |
| 131056     | Wait at least 60 seconds before retrying to the same recipient. |
| 5xx        | Retry with exponential backoff, max 3 attempts. |

### Non-Retryable Errors (Do NOT Retry)

| Error Code | Correct Action                                                      |
|------------|----------------------------------------------------------------------|
| 131026     | Bucket error — investigate specific cause (see 131026 section). |
| 131042     | Wait 72 hours. Do NOT retry >10 times. Verify payment method. |
| 131047     | Send an approved template message instead. |
| 131049     | Per-user marketing limit. Wait 24h before resending. |
| 131050     | Respect the opt-out. Do not send marketing messages. |
| 132000     | Fix parameter count in code. |
| 132001     | Verify template name and language exist and are approved. |
| 132015     | Fix template quality or create new. |
| 133010     | Complete phone registration first. |
| 190        | Get a new access token. |

### Recommended Backoff

```
Attempt 1: Wait 1 second
Attempt 2: Wait 2 seconds
Attempt 3: Wait 4 seconds
Attempt 4: Wait 8 seconds
Max wait: 60 seconds
Max attempts: 5 (rate limits), 3 (server errors)
```

Add jitter (random 0-500ms) to prevent thundering herd.

---

## Sources

- [WhatsApp Cloud API — Error Codes](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes)
- [WhatsApp Cloud API — Throughput](https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput)
- [WhatsApp Cloud API — Marketing Message Experiments](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/experiments)
- [WhatsApp Cloud API — Per-User Marketing Template Limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits)

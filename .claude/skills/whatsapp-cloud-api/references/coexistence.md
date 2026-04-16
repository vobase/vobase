# WhatsApp Cloud API — Coexistence Reference

> **Author:** Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## Overview

Coexistence allows a single phone number to operate simultaneously on both the WhatsApp Business App (mobile) and the Cloud API. The phone functions as the primary device, and the Cloud API is treated as a linked companion device.

Messages flow bidirectionally:
- Messages sent via the Cloud API appear in the WhatsApp Business App
- Messages sent from the Business App trigger `smb_message_echoes` webhook events to the Cloud API

Coexistence reached general availability in early 2025. It is described as "Phase 1" — group chats and calls are expected in future phases.

---

## Requirements

| Requirement | Detail |
|-------------|--------|
| WhatsApp Business App version | **v2.24.17** or newer |
| Account age | At least **7 days** of active Business App usage before eligible |
| Active usage | App must be opened at least once every **14 days** or Cloud API connection is removed |
| App must stay installed | Uninstalling the Business App immediately severs the Cloud API connection |
| Onboarding | Via Embedded Signup flow (QR code scan from the Business App) |

### Country Availability

Supported in most regions including India, US, Mexico, Brazil, Indonesia, Singapore, Hong Kong, EU, and UK. **Not supported** in Nigeria and South Africa as of March 2026.

---

## Feature Compatibility

| Feature | Coexistence Status | Notes |
|---------|-------------------|-------|
| 1:1 chat (send/receive) | Supported | Fully mirrored both directions |
| Contact sync | Supported | One-way: Business App → Cloud API |
| Chat history import | Supported | Up to 6 months, 1:1 only |
| Template messages via API | Supported | Must be sent via API, not from the app |
| Group chats | Not supported | Phase 1 limitation; no sync |
| Broadcast lists | Disabled | Existing lists become read-only |
| Disappearing messages | Disabled | Automatically off for all 1:1 chats |
| View-once messages | Disabled | Cannot send or receive |
| Live location sharing | Disabled | Not available in 1:1 chats |
| Message edit / revoke | Disabled | Not supported in 1:1 chats |
| Voice/video calls | Not supported | Phase 1 limitation |
| Business catalog / orders | Not supported | Not synced |
| Business profile management | Not supported | Cannot update via API |
| Quick replies, labels, greeting messages | Not supported | Business tools not synced |
| WhatsApp Channels | Not supported | |
| Official Business Account (blue badge) | Not supported | |
| Marketing Messages Lite API | Not compatible | |

---

## Chat History Synchronization

- **What syncs:** 1:1 individual chat messages from the past **6 months**
- **What doesn't sync:** Group chats, voice/video calls, business tool interactions
- **Sync direction:** Historical import is one-time at onboarding; new messages mirror bidirectionally going forward
- **Sync duration:** Up to **4–6 hours** depending on data volume
- **During sync:** WhatsApp Business App must remain open with stable internet
- **User choice:** During setup the user selects whether to share all chats — this choice **cannot be modified later** without re-onboarding

---

## Contact Synchronization

- All contacts with WhatsApp numbers sync **one-way** from the Business App to the Cloud API
- Future edits in the Business App reflect in the API platform
- Contact sync runs in background; progress may be visible in some platforms
- Chat history sync progress is separate and may not show an indicator

---

## SMB Message Echoes

Messages sent from the WhatsApp Business App are delivered to the Cloud API via the `smb_message_echoes` webhook field.

### Webhook Payload

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "BUSINESS_PHONE",
          "phone_number_id": "PHONE_NUMBER_ID"
        },
        "message_echoes": [{
          "from": "BUSINESS_PHONE",
          "to": "CUSTOMER_PHONE",
          "id": "wamid.XXX",
          "timestamp": "1683229471",
          "type": "text",
          "text": { "body": "Message from Business App" }
        }]
      },
      "field": "smb_message_echoes"
    }]
  }]
}
```

### Echo Behavioral Constraints

- Echoes do **NOT** open a service window (24h conversation window)
- Echoes do **NOT** trigger automation rules
- Echoes do **NOT** start a new conversation in most platforms
- They will create a contact if none exists
- Edited messages display an "Edited" label but follow the same restrictions

### Supported Companion Devices for Echoes

| Device | Echoes Triggered |
|--------|-----------------|
| WhatsApp Web | Yes |
| WhatsApp for Mac | Yes |
| WhatsApp for Windows | **No** — messages silently dropped from API mirror |
| WearOS | **No** — messages silently dropped |

> **Gotcha:** Messages sent from unsupported companion devices (Windows, WearOS) are invisible to the Cloud API. This can cause conversation gaps.

---

## Error 131060 — Companion Device Visibility

This error occurs when a message originates from an unsupported companion device and cannot be made visible to the Cloud API.

- Surfaces as a visibility/routing failure
- On unsupported companion devices, messages may render with placeholder text
- **Resolution:** Use only WhatsApp Web or WhatsApp for Mac when operating in coexistence mode

---

## 14-Day Linked Device Expiry

The WhatsApp Business App must be opened at least once every **14 days**. This mirrors how WhatsApp handles all linked devices:

- If the app is not opened within 14 days, the Cloud API connection is **automatically removed**
- After disconnection, full re-onboarding is required
- Sync re-initialization may take several hours

> **Best practice:** Advise customers to set a weekly reminder to open the Business App.

---

## Offboarding / Disconnection

Disconnection **must** be initiated from the WhatsApp Business App — there is no API-side toggle.

### Steps

1. Open the WhatsApp Business App
2. Go to **Settings → Account → Business Platform**
3. Tap the connected platform
4. Tap **Disconnect**

### Post-Offboarding Behavior

- All companion devices are automatically unlinked
- Messages stop appearing in the Cloud API platform
- User data persists in the WhatsApp Business App
- Numbers previously on the API have a **1–2 month cooldown** before re-onboarding is possible

---

## Gotchas Summary

| Issue | Detail |
|-------|--------|
| Business name locked | Cannot be changed post-onboarding without Meta support |
| Sync choice is permanent | Cannot change whether to share chats after onboarding |
| Previously API-registered numbers | Must wait 1–2 months after deleting old WABA |
| Template messages | Can only be sent via API/CRM, not from the Business App |
| Broadcast rate limit | Subject to stricter **20 msg/sec** cap in some configurations |
| Unsupported device messages | Windows/WearOS messages don't echo to Cloud API |
| App uninstall = disconnect | Immediately severs the Cloud API connection |
| Standard Business Verification | Not available; use Partner-Led Business Verification (PLBV) instead |

---

## Sources

- [Meta — Onboarding Business App Users (Coexistence)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [360Dialog — WhatsApp Coexistence](https://docs.360dialog.com/partner/waba-management/whatsapp-coexistence)
- [360Dialog — Coexistence Webhooks](https://docs.360dialog.com/partner/waba-management/whatsapp-coexistence/coexistence-webhooks)
- [Wati.io — Introducing WhatsApp Coexistence](https://support.wati.io/en/articles/11822402-introducing-whatsapp-coexistence)
- [respond.io — WhatsApp Coexistence Quick Start](https://respond.io/help/whatsapp/whatsapp-coexistence)
- [WhatsApp Help Center — Linked Devices](https://faq.whatsapp.com/1046791737425017/)

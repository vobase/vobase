# WhatsApp Cloud API — Groups API Reference

> **Author:** Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## Overview

The Groups API enables businesses to programmatically create WhatsApp group conversations, manage membership via invite links, send messages to multiple participants, and receive webhook notifications for group events.

**GA date:** October 6, 2025.

---

## Eligibility Requirements

| Requirement | Detail |
|-------------|--------|
| Official Business Account | Green verification badge (OBA) required. Standard accounts excluded. |
| Messaging volume | At least **100,000 monthly business-initiated conversations** |
| Coexistence users | **Not eligible** |

Access is requested through a Key Account Manager or Meta's API access flow.

---

## Group Limits

| Limit | Value |
|-------|-------|
| Max participants per group | **8** (including the business admin) |
| Max groups per phone number | **10,000** |
| Admin accounts per group | 1 (only the creating phone number) |

---

## Group Management

### Create a Group

```
POST https://graph.facebook.com/v22.0/{phone-number-id}/groups
```

```json
{
  "subject": "Customer Support Group",
  "description": "Support channel for premium customers",
  "approval_required": false
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subject` | string | Yes | Group display name |
| `description` | string | No | Group description |
| `approval_required` | boolean | No | Whether members must be approved before joining via invite link |

Response includes `group_id` and `invite_link`.

> **Note:** Members cannot be added directly at creation. The flow is: create group → distribute invite link → members join voluntarily (optionally with admin approval).

### Get Group Info

```
GET https://graph.facebook.com/v22.0/{phone-number-id}/groups/{group-id}
```

Returns subject, description, invite link, and participant list.

### Update Group Metadata

```
PATCH https://graph.facebook.com/v22.0/{phone-number-id}/groups/{group-id}
```

| Operation | Body |
|-----------|------|
| Update name | `{ "subject": "New Name" }` |
| Update description | `{ "description": "New description" }` |
| Update icon | `{ "icon": "MEDIA_ID" }` (pre-uploaded via media endpoint) |
| Reset invite link | `{ "reset_invite_link": true }` |

### Join Request Management

When `approval_required: true`:

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Get pending requests | GET | `/{phone-number-id}/groups/{group-id}/join-requests` |
| Approve requests | POST | `/{phone-number-id}/groups/{group-id}/join-requests` |
| Reject requests | DELETE | `/{phone-number-id}/groups/{group-id}/join-requests` |

**Approve body:** `{ "phones": ["+1234567890"] }` or `{ "all": true }`

### Remove a Participant

```
DELETE https://graph.facebook.com/v22.0/{phone-number-id}/groups/{group-id}/participants
```

```json
{ "phone": "+1234567890" }
```

### Delete a Group

```
DELETE https://graph.facebook.com/v22.0/{phone-number-id}/groups/{group-id}
```

> **Warning:** Permanent, cannot be undone.

---

## Sending Messages to Groups

Use the same messages endpoint as 1:1, with `recipient_type` set to `"group"`:

### Text Message

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "group",
  "to": "GROUP_ID",
  "type": "text",
  "text": { "body": "Hello group!" }
}
```

### Template Message

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "group",
  "to": "GROUP_ID",
  "type": "template",
  "template": {
    "name": "hello_world",
    "language": { "code": "en_US" }
  }
}
```

---

## Supported Message Types

| Type | Supported |
|------|-----------|
| Text | Yes |
| Image | Yes |
| Video | Yes |
| Document | Yes |
| Audio | Yes |
| Sticker | Yes (receive only) |
| Template (text/media body) | Yes — utility category |
| Reactions | Limited |

---

## Unsupported Features

| Feature | Status |
|---------|--------|
| Interactive messages (buttons, lists, carousels) | Not supported |
| Authentication templates | Not supported |
| Commerce templates | Not supported |
| Voice and video calls | Not supported |
| Disappearing messages | Not supported |
| View-once media | Not supported |
| Mark-as-read | Not supported |
| Message editing or deletion | Not supported |
| Promoting/demoting admins | Not supported in official Cloud API |
| Directly adding participants (without invite) | Not supported |

---

## Webhooks

Group messages arrive via the standard `messages` webhook field. The key difference is the presence of a `group_id` field.

### Inbound Group Message

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "PHONE_NUMBER",
          "phone_number_id": "PHONE_NUMBER_ID"
        },
        "contacts": [{ "profile": { "name": "Sender" }, "wa_id": "SENDER_PHONE" }],
        "messages": [{
          "from": "SENDER_PHONE",
          "id": "wamid.XXX",
          "timestamp": "1234567890",
          "group_id": "GROUP_ID",
          "type": "text",
          "text": { "body": "Hello" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

> **Key distinction from 1:1:** Inbound group messages include a `group_id` field. Use this to route messages to the correct group conversation.

Members joining or leaving via invite link also trigger webhook notifications under the `messages` field.

---

## Pricing

Billing is **per-delivered message, per recipient**. If a template is sent to a group with 5 members, you are charged for 5 delivered messages.

- Country-based pricing rates apply (same rate table as 1:1)
- Service messages within a 24-hour customer-initiated window are free
- Non-template service messages are always free

---

## Sources

- [WhatsApp Groups API — Overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/overview)
- [WhatsApp Groups API — Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started/)
- [WhatsApp Groups API — Group Messaging](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/)
- [WhatsApp Groups API — Reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference/)
- [WhatsApp Groups API — Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/pricing/)

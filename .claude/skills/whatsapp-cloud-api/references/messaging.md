# WhatsApp Cloud API - Messaging Reference

> **Author:** Bello Sanchez, Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## Overview

This document covers all supported message types for the WhatsApp Cloud API send-message endpoint. Every outbound message is sent through a single unified endpoint, differentiated by the `type` field in the request body.

---

## Endpoint

```
POST https://graph.facebook.com/v22.0/{phone-number-id}/messages
```

| Header            | Value                      |
|-------------------|----------------------------|
| `Authorization`   | `Bearer {access-token}`    |
| `Content-Type`    | `application/json`         |

Every request body **must** include:

```json
{
  "messaging_product": "whatsapp"
}
```

---

## Message Types Summary

| Type         | Field Key      | Max Size / Length         | Supports Caption | Supports Media ID |
|--------------|----------------|--------------------------|------------------|--------------------|
| `text`       | `text`         | 4096 characters          | N/A              | N/A                |
| `image`      | `image`        | 5 MB                     | Yes              | Yes                |
| `video`      | `video`        | 16 MB                    | Yes              | Yes                |
| `audio`      | `audio`        | 16 MB                    | No               | Yes                |
| `document`   | `document`     | 100 MB                   | Yes              | Yes                |
| `sticker`    | `sticker`      | 100 KB static / 500 KB animated | No       | Yes                |
| `location`   | `location`     | N/A                      | N/A              | N/A                |
| `contacts`   | `contacts`     | N/A                      | N/A              | N/A                |
| `reaction`   | `reaction`     | N/A                      | N/A              | N/A                |

---

## Text Message

Sends a plain text message. Supports optional URL preview rendering.

**Fields:**

| Field         | Type    | Required | Description                                      |
|---------------|---------|----------|--------------------------------------------------|
| `body`        | string  | Yes      | The text content. Max 4096 characters.            |
| `preview_url` | boolean | No       | Set `true` to render a link preview. Default `false`. |

**Example:**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "text",
  "text": {
    "body": "Hello! Your order has been confirmed.",
    "preview_url": false
  }
}
```

---

## Image Message

Sends an image via a public URL or a previously uploaded media ID.

**Supported formats:** JPEG, PNG
**Max size:** 5 MB

**Fields:**

| Field     | Type   | Required       | Description                              |
|-----------|--------|----------------|------------------------------------------|
| `link`    | string | Yes (or `id`)  | Public HTTPS URL of the image.           |
| `id`      | string | Yes (or `link`) | Media ID from a prior upload.           |
| `caption` | string | No             | Text caption displayed below the image.  |

**Example (by link):**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "image",
  "image": {
    "link": "https://example.com/image.jpg",
    "caption": "Check this out"
  }
}
```

**Example (by media ID):**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "image",
  "image": {
    "id": "1234567890",
    "caption": "Uploaded image"
  }
}
```

---

## Video Message

Sends a video file via URL or media ID.

**Supported formats:** MP4, 3GPP
**Max size:** 16 MB
**Note:** Only H.264 video codec and AAC audio codec are supported.

**Fields:**

| Field     | Type   | Required       | Description                              |
|-----------|--------|----------------|------------------------------------------|
| `link`    | string | Yes (or `id`)  | Public HTTPS URL of the video.           |
| `id`      | string | Yes (or `link`) | Media ID from a prior upload.           |
| `caption` | string | No             | Text caption displayed with the video.   |

**Example:**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "video",
  "video": {
    "link": "https://example.com/video.mp4",
    "caption": "Watch this"
  }
}
```

---

## Audio Message

Sends an audio file. No caption support.

**Supported formats:** AAC, MP3, MP4 Audio, OGG (OPUS codec only)
**Max size:** 16 MB

**Fields:**

| Field  | Type   | Required       | Description                              |
|--------|--------|----------------|------------------------------------------|
| `link` | string | Yes (or `id`)  | Public HTTPS URL of the audio file.      |
| `id`   | string | Yes (or `link`) | Media ID from a prior upload.           |

**Example:**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "audio",
  "audio": {
    "link": "https://example.com/audio.mp3"
  }
}
```

---

## Document Message

Sends a document of any file type.

**Max size:** 100 MB

**Fields:**

| Field      | Type   | Required       | Description                                         |
|------------|--------|----------------|-----------------------------------------------------|
| `link`     | string | Yes (or `id`)  | Public HTTPS URL of the document.                   |
| `id`       | string | Yes (or `link`) | Media ID from a prior upload.                      |
| `filename` | string | No             | Display name for the file in the chat.              |
| `caption`  | string | No             | Text caption displayed with the document.           |

**Example:**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "document",
  "document": {
    "link": "https://example.com/doc.pdf",
    "filename": "invoice.pdf",
    "caption": "Your invoice"
  }
}
```

---

## Sticker Message

Sends a sticker image. No caption support.

**Supported format:** WebP
**Max size:** 100 KB (static), 500 KB (animated)
**Dimensions:** 512x512 pixels recommended

**Fields:**

| Field  | Type   | Required       | Description                              |
|--------|--------|----------------|------------------------------------------|
| `link` | string | Yes (or `id`)  | Public HTTPS URL of the sticker.         |
| `id`   | string | Yes (or `link`) | Media ID from a prior upload.           |

**Example:**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "sticker",
  "sticker": {
    "link": "https://example.com/sticker.webp"
  }
}
```

---

## Location Message

Sends a geographic location pin.

**Fields:**

| Field       | Type   | Required | Description                                      |
|-------------|--------|----------|--------------------------------------------------|
| `latitude`  | number | Yes      | Latitude coordinate.                             |
| `longitude` | number | Yes      | Longitude coordinate.                            |
| `name`      | string | No       | Name of the location (displayed as title).       |
| `address`   | string | No       | Street address of the location.                  |

**Example:**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "location",
  "location": {
    "latitude": 18.4861,
    "longitude": -69.9312,
    "name": "Office HQ",
    "address": "Av. Winston Churchill, Santo Domingo"
  }
}
```

---

## Contact Message

Sends a structured contact card. Supports multiple contacts in a single message.

**Required nested fields:** At minimum, `name.formatted_name` is required per contact.

**Contact object fields:**

| Field       | Type   | Required | Description                                |
|-------------|--------|----------|--------------------------------------------|
| `name`      | object | Yes      | Contact name object (see below).           |
| `phones`    | array  | No       | List of phone number objects.              |
| `emails`    | array  | No       | List of email objects.                     |
| `urls`      | array  | No       | List of URL objects.                       |
| `addresses` | array  | No       | List of address objects.                   |
| `org`       | object | No       | Organization object.                      |
| `birthday`  | string | No       | Birthday in `YYYY-MM-DD` format.           |

**Name object fields:**

| Field            | Type   | Required | Description            |
|------------------|--------|----------|------------------------|
| `formatted_name` | string | Yes      | Full formatted name.   |
| `first_name`     | string | No       | First name.            |
| `last_name`      | string | No       | Last name.             |

**Example:**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "contacts",
  "contacts": [
    {
      "name": {
        "formatted_name": "Maria Garcia",
        "first_name": "Maria",
        "last_name": "Garcia"
      },
      "phones": [
        {
          "phone": "+18095551234",
          "type": "WORK",
          "wa_id": "18095551234"
        }
      ],
      "emails": [
        {
          "email": "maria@example.com",
          "type": "WORK"
        }
      ],
      "org": {
        "company": "Acme Corp",
        "title": "Director"
      }
    }
  ]
}
```

---

## Reaction Message

Reacts to a previously received or sent message with an emoji. To remove a reaction, send an empty string as the emoji.

**Fields:**

| Field        | Type   | Required | Description                                         |
|--------------|--------|----------|-----------------------------------------------------|
| `message_id` | string | Yes      | The `wamid` of the message to react to.             |
| `emoji`      | string | Yes      | A single emoji character. Empty string removes reaction. |

**Example (add reaction):**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "reaction",
  "reaction": {
    "message_id": "wamid.HBgLMTgwOTEyMzQ1NjcVAgASGBQzRUIwMEY2QjBCNDY2N0YwMzAzMAA=",
    "emoji": "\ud83d\udc4d"
  }
}
```

**Example (remove reaction):**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "reaction",
  "reaction": {
    "message_id": "wamid.HBgLMTgwOTEyMzQ1NjcVAgASGBQzRUIwMEY2QjBCNDY2N0YwMzAzMAA=",
    "emoji": ""
  }
}
```

---

## Reply / Context (Quoting a Message)

Any message type can be sent as a reply to a previous message by including the `context` object at the root level. This renders the original message as a quoted block above the new message.

**Context fields:**

| Field        | Type   | Required | Description                                    |
|--------------|--------|----------|------------------------------------------------|
| `message_id` | string | Yes      | The `wamid` of the message being replied to.   |

**Example (text reply):**

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "context": {
    "message_id": "wamid.HBgLMTgwOTEyMzQ1NjcVAgASGBQzRUIwMEY2QjBCNDY2N0YwMzAzMAA="
  },
  "type": "text",
  "text": {
    "body": "Yes, that works for me!"
  }
}
```

**Note:** The `context` object can be combined with any message type (`image`, `document`, `video`, etc.) to send a reply of that type.

---

## Response Format

All successful send requests return the following structure:

```json
{
  "messaging_product": "whatsapp",
  "contacts": [
    {
      "input": "+18091234567",
      "wa_id": "18091234567"
    }
  ],
  "messages": [
    {
      "id": "wamid.HBgLMTgwOTEyMzQ1NjcVAgASGBQzRUIwMEY2QjBCNDY2N0YwMzAzMAA="
    }
  ]
}
```

**Response fields:**

| Field                 | Type   | Description                                           |
|-----------------------|--------|-------------------------------------------------------|
| `messaging_product`   | string | Always `"whatsapp"`.                                  |
| `contacts[].input`    | string | The phone number as provided in the request.          |
| `contacts[].wa_id`    | string | The WhatsApp ID associated with the phone number.     |
| `messages[].id`       | string | The unique message ID (`wamid`). Use this for reactions, replies, and status tracking. |

---

## Error Handling

When a request fails, the API returns a structured error response:

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

**Common error codes:**

| Code   | Description                                        |
|--------|----------------------------------------------------|
| 131026 | Message undeliverable (recipient not on WhatsApp, outdated client, etc.). |
| 131031 | Account has been locked (policy violation or incorrect two-step PIN). |
| 131047 | Re-engagement message — 24-hour window expired.    |
| 131051 | Unsupported message type.                          |
| 131053 | Media upload error.                                |
| 130429 | Rate limit reached. Retry after backoff.           |
| 132000 | Template parameter count mismatch.                 |
| 132001 | Template does not exist (wrong name or language).  |

---

## Important Notes

1. **24-Hour Messaging Window:** You can only send free-form messages to users who have messaged you within the last 24 hours. Outside this window, you must use an approved message template.

2. **Phone Number Format:** The `to` field accepts phone numbers in E.164 format (e.g., `+18091234567`) or without the `+` prefix. Country code is always required.

3. **Media by Link vs. ID:** When using `link`, the URL must be publicly accessible over HTTPS. When using `id`, the media must have been previously uploaded via the Media API (`POST /{phone-number-id}/media`).

4. **Idempotency:** The API does not provide built-in idempotency. Duplicate sends will result in duplicate messages delivered to the recipient.

5. **Rate Limits:** Sending limits depend on your phone number quality rating and tier. New numbers start at Tier 1 (1,000 unique contacts per 24 hours) and can be upgraded based on usage quality.

6. **Reply Threading:** To send a threaded reply, include `context: { message_id: "wamid..." }` in the request body. The original message appears as a quoted block. Without this, the recipient sees the message as standalone — not as a reply to their message.

7. **24-Hour Window:** Only the customer's last incoming message resets the 24-hour service window. Your outgoing messages do NOT extend it. Outside the window, only template messages can be sent (error `131047`).

---

## Sources

- [WhatsApp Cloud API — Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages)
- [WhatsApp Cloud API — Send Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)
- [WhatsApp Cloud API — Reference: Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages)

# WhatsApp Cloud API - Media Reference

> **Author:** Bello Sanchez, Vobase
> **API Version:** v22.0
> **Last Updated:** 2026-03-16

---

## Upload Media

```
POST https://graph.facebook.com/v22.0/{phone-number-id}/media
```

| Header          | Value                       |
|-----------------|-----------------------------|
| `Authorization` | `Bearer {access-token}`     |
| `Content-Type`  | `multipart/form-data`       |

| Field                | Type   | Required | Description                                    |
|----------------------|--------|----------|------------------------------------------------|
| `file`               | binary | Yes      | The media file binary data.                    |
| `type`               | string | Yes      | MIME type of the file (e.g., `image/jpeg`).    |
| `messaging_product`  | string | Yes      | Must be `"whatsapp"`.                          |

**Response:**

```json
{
  "id": "MEDIA_ID"
}
```

The returned `id` is valid for 30 days and can be reused across multiple messages.

---

## Retrieve Media URL

### Step 1: Get the Download URL

```
GET https://graph.facebook.com/v22.0/{media-id}
```

**Response:**

```json
{
  "url": "https://lookaside.fbsbx.com/...",
  "mime_type": "image/jpeg",
  "sha256": "a1b2c3...",
  "file_size": 123456,
  "id": "MEDIA_ID",
  "messaging_product": "whatsapp"
}
```

### Step 2: Download the Binary

```
GET {download-url}
Authorization: Bearer {access-token}
```

> **Important:** The download URL is temporary and expires. Always retrieve a fresh URL before downloading.

---

## Delete Media

```
DELETE https://graph.facebook.com/v22.0/{media-id}
Authorization: Bearer {access-token}
```

**Response:** `{ "success": true }`

---

## Supported Formats and Size Limits

| Type              | Supported Formats                         | Max Size |
|-------------------|-------------------------------------------|----------|
| Image             | JPEG, PNG                                 | 5 MB     |
| Video             | MP4, 3GPP                                 | 16 MB    |
| Audio             | AAC, MP4 Audio, MPEG, AMR, OGG (Opus only) | 16 MB  |
| Document          | Any valid MIME type                       | 100 MB   |
| Sticker (static)  | WebP                                      | 100 KB   |
| Sticker (animated)| WebP                                      | 500 KB   |

### Format Notes

- **Video**: Only H.264 video codec and AAC audio codec supported for MP4.
- **Audio**: OGG files must use Opus codecs; Vorbis is not supported.
- **Sticker**: Must be 512x512 pixels.
- **Document**: Common types include PDF, DOCX, XLSX, PPTX, TXT.

---

## Sending Media in Messages

### By Link (Hosted URL)

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "image",
  "image": {
    "link": "https://example.com/photo.jpg",
    "caption": "Check out this image"
  }
}
```

### By Media ID (Pre-uploaded)

```json
{
  "messaging_product": "whatsapp",
  "to": "+18091234567",
  "type": "image",
  "image": {
    "id": "MEDIA_ID",
    "caption": "Check out this image"
  }
}
```

### Comparison

| Aspect           | By Link                                     | By Media ID                                 |
|------------------|---------------------------------------------|---------------------------------------------|
| Setup            | Simpler — just provide a public URL         | Requires a prior upload step                |
| Speed            | Slower — WhatsApp re-downloads each time    | Faster — already cached on WhatsApp servers |
| Reliability      | Depends on URL availability                 | Reliable once uploaded                      |
| Expiration       | URL must remain accessible                  | Media ID valid for 30 days                  |
| Best for         | Quick prototyping, infrequent media         | High-volume, repeatedly sent media          |

---

## Media ID Lifecycle

1. **Upload** — Returns a Media ID valid for 30 days.
2. **Use** — Reference in as many messages as needed within the 30-day window.
3. **Expiration** — After 30 days the ID becomes invalid. Re-upload to get a new ID.
4. **Deletion** — Calling DELETE removes the media immediately.

> **Gotcha:** Media IDs are opaque strings. You cannot infer the media type (image, video, document) from the ID itself. Always track the type separately when storing Media IDs.

---

## Incoming Media — Download Window

When receiving media messages via webhook, the media `id` must be used to fetch a download URL. **The download URL expires in approximately 5 minutes.**

```
1. Receive webhook with media id
2. GET /v22.0/{media-id} → returns temporary download URL
3. GET {download-url} with Authorization header → raw binary
```

> **Critical:** Download media immediately upon receiving the webhook. If processing is delayed beyond ~5 minutes, the URL expires and returns 401. This is URL expiry, not an auth failure — do not trigger re-authentication alerts.

If the URL has expired, call `GET /v22.0/{media-id}` again to get a fresh URL.

---

## Sources

- [WhatsApp Cloud API — Media](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media)
- [WhatsApp Cloud API — Supported Media Types](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#supported-media-types)

---
"@vobase/template": minor
---

# Magic-link finish + notification-settings collapse

Closes out the per-env magic-link refactor and collapses the notification-tier channel into a single first-class table. Hard cutover — no dual-shape, no env-var fallback, no deferred follow-ups.

## Tenant-side magic-link finish

The `/auth/magic-finish` route is now covered by a full security test suite (`auth/magic-finish.test.ts`, 7 cases): happy-path cookie issuance, single-use replay rejection, expired-token deletion, organization-membership gating, open-redirect rejection, missing-param handling, and the platform challenge probe.

Token verification was simplified to better-auth's internal `consumeVerificationValue` (atomic read+delete), removing the hand-rolled attempt-counter and the race between `findVerificationValue` and the manual attempt bump. A pinned comment documents why the full `auth.api.magicLinkVerify` endpoint is not adopted (it owns the redirect, sets its own cookie, and has no organization-membership gate).

## notification_settings — one row per org

The platform-routed notification number is no longer modeled as a fake `channel_instances` row. A new `notification_settings` table holds one row per organization:

| Column | Purpose |
|---|---|
| `notificationEndpointId` | platform webhook endpoint for staff-notification routing |
| `magicLinkEndpointId` | platform webhook endpoint for the magic-link finish redirect |
| `platformHmacSecretEnvelope` | envelope-encrypted HMAC secret for outbound platform calls |
| `platformBaseUrl` | platform host for relayed sends |
| `displayPhoneNumber` / `phoneNumberId` / `wabaId` | WhatsApp number metadata |

`getNotificationSettings` / `upsertNotificationSettings` / `decryptNotificationHmac` are the single write path. `sendNotificationText` replaces the WhatsApp adapter's `managed-notif` send branch.

## Bootstrap auto-registration — no manual operator step

`claimAndBootstrap` now runs `provisionNotificationSettings` as a required step: it claims the platform notification number, registers both the `whatsapp_notif` and `magic_link` webhook endpoints, and writes the `notification_settings` row — idempotently, so re-running on a provisioned org is a no-op. The old `MAGIC_LINK_ENDPOINT_ID` environment variable is gone; the endpoint id is read from the database row.

## Removed

Hard cutover deleted every surface that existed only because the notification number was forced through the channel registry:

- `notification` kind from the managed-channel registry; `ManagedChannelKind` narrowed to `sandbox`
- `isManagedNotifConfig` predicate + the `managed-notif` instance mode
- `vobase-platform-notification` vault provider
- `staff_reply` inbound-dispatch branch + `staff-reply-dispatch.ts`
- `whatsapp_notif` channel registration + `WHATSAPP_NOTIF_CHANNEL_NAME`
- `findNotificationChannel` service helper
- `MAGIC_LINK_ENDPOINT_ID` environment variable
- "Connect platform notification" rows, chips, and dialog options across the channels UI

## Test coverage

43 files changed. New: `magic-finish.test.ts` (7 cases), `notification-provision.test.ts` (2 cases), plus two notification-path cases in `bootstrap.test.ts`. 13 existing test files migrated from the `findNotificationChannel` / `whatsapp_notif` fixture shape to `getNotificationSettings` / `upsertNotificationSettings`. Targeted suites 77/77 green; full template suite 741 passing.

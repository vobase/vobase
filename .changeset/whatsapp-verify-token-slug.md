---
'@vobase/template': patch
---

fix(whatsapp): use tenant slug, not nanoid, for webhook verify-token derivation

The sandbox-claim flow's earlier `X-Tenant-Id` fix correctly switched the
platform-call header to `PLATFORM_TENANT_ID` (the nanoid), but also accidentally
passed the nanoid as `tenantSlug` into `deriveVerifyToken`. The WhatsApp adapter's
GET hub-challenge handler derives the expected token from
`VITE_PLATFORM_TENANT_SLUG` (the human slug), so the two HKDF derivations
disagreed. Platform's webhook self-registration GET hit the tenant URL with the
wrong `hub.verify_token`, got 403, and surfaced in the UI as
"platform webhook registration failed (400: http_403)".

Threaded `tenantSlug` through `PlatformCreds` and use it for verify-token
derivation on both `/managed/claim` and `/managed/:id/webhook/re-verify` paths.
`X-Tenant-Id` continues to use the nanoid via `tenantId`.

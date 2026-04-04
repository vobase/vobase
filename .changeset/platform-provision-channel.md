---
"@vobase/core": minor
---

feat(core): platform-core alignment — provision-channel route, X-Tenant-Slug, HMAC helper

**Platform integration routes:**
- Added `onProvisionChannel` callback to `PlatformRoutesConfig` and `CreateAppConfig`
- New `POST /api/integrations/provision-channel` route — conditionally registered, HMAC-verified, Zod-validated, sanitized 502 on callback errors
- Exported `ProvisionChannelData`, `ProvisionChannelCtx`, and `PlatformRoutesConfig` types
- Extracted `verifyPlatformRequest()` helper to deduplicate HMAC guard across all 3 routes
- Updated frozen contract documentation

**Platform token refresh:**
- `refreshViaPlat` now sends `X-Tenant-Slug` header (from `PLATFORM_TENANT_SLUG` env var)
- Throws descriptive error if env var is missing instead of sending empty string

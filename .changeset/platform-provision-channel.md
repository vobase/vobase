---
"@vobase/core": minor
---

feat(core): add provision-channel route to platform integration routes

- Added `onProvisionChannel` optional callback to `PlatformRoutesConfig` and `CreateAppConfig`
- New `POST /api/integrations/provision-channel` route (HMAC-verified, Zod-validated)
- Route is conditionally registered only when `onProvisionChannel` callback is provided
- Callback errors return sanitized 502 response; real errors logged server-side
- Exported `ProvisionChannelData` and `PlatformRoutesConfig` types
- Updated frozen contract documentation

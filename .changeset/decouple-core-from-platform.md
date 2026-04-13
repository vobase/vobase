---
"@vobase/core": minor
---

# Decouple Core from Platform

Remove all platform-specific code from `@vobase/core`, making it a fully generic framework. Platform-specific functionality (auth plugins, push routes, token refresh) now belongs in the template layer.

## Breaking Changes

### Removed Exports

| Removed Export | Replacement |
|---|---|
| `signPlatformRequest(payload, secret)` | `signHmac(payload, secret)` — identical signature, drop-in rename |
| `verifyPlatformSignature(body, sig)` | `verifyHmacSignature(body, sig, secret)` — now requires explicit secret parameter |
| `isPlatformEnabled()` | Check `process.env.PLATFORM_HMAC_SECRET` directly |
| `createPlatformIntegrationsRoutes(config)` | Removed — relocate to template if needed |
| `PlatformRoutesConfig` | Removed |
| `platformAuth(config)` | Relocate to template, register via `extraPlugins` in auth config |
| `PlatformAuthConfig` | Relocate to template |
| `refreshViaPlat(provider, url, secret)` | Use `setPlatformRefresh(fn)` to register a callback |

### Migration Guide

**HMAC signing:**
```ts
// Before
import { signPlatformRequest } from '@vobase/core';
const sig = signPlatformRequest(payload, secret);

// After
import { signHmac } from '@vobase/core';
const sig = signHmac(payload, secret);
```

**Token refresh delegation:**
```ts
// Before: core called refreshViaPlat() internally when PLATFORM_HMAC_SECRET was set

// After: register a callback in your module init hook
import { setPlatformRefresh } from '@vobase/core';

setPlatformRefresh(async (provider) => {
  // Your refresh logic — call platform, return { accessToken, expiresInSeconds? }
});
```

**Auth plugin:**
```ts
// Before: platformAuth was auto-registered when PLATFORM_HMAC_SECRET was set

// After: register via extraPlugins in auth config
createApp({
  auth: {
    extraPlugins: [myPlatformAuthPlugin({ hmacSecret: process.env.PLATFORM_HMAC_SECRET })],
  },
});
```

## New Exports

| Export | Description |
|---|---|
| `signHmac(payload, secret)` | HMAC-SHA256 signing (replaces `signPlatformRequest`) |
| `setPlatformRefresh(fn)` | Register a token refresh callback for platform-managed integrations |
| `getPlatformRefresh()` | Retrieve the registered refresh callback |
| `PlatformRefreshFn` | Type: `(provider: string) => Promise<RefreshResult>` |
| `ProvisionChannelData` | Re-exported from `channels/service` (was in `platform.ts`, `source` widened to `string`) |

## Internal Changes

- `getRefreshMode()` now checks for a registered callback instead of env vars. Logs a warning when `PLATFORM_HMAC_SECRET` + `PLATFORM_URL` are set but no callback is registered.
- Webhook handler uses `verifyHmacSignature` with explicit secret parameter instead of `verifyPlatformSignature` which read the secret from env internally.
- `ProvisionChannelData.source` widened from `'platform' | 'sandbox'` to `string` for generic use.

## Bug Fix

- Fixed `PLATFORM_TENANT_SLUG` not being set during tenant provisioning (both production and staging flows), which caused token refresh to fail for all provisioned tenants.

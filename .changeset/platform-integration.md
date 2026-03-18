---
"@vobase/core": minor
---

# Platform Integration Infrastructure

Adds opt-in infrastructure for vobase-platform proxy integration — enabling managed OAuth, webhook forwarding, and credential provisioning for multi-tenant deployments.

## Platform Session Auth

New `createPlatformSession()` on the AuthAdapter contract creates trusted sessions for users authenticated via the platform OAuth proxy. The platform verifies identity via JWT signed with HMAC-SHA256 — core validates the signature and creates a session directly without email/password auth.

- `GET /api/auth/platform-callback?token=JWT` — accepts signed handoff JWT, creates or finds user, returns session cookie
- New users get a strong random password (never used — auth is always via platform JWT)
- 30-day session expiry matching better-auth defaults

Activated when `PLATFORM_HMAC_SECRET` env var is set. No-op otherwise.

## Platform-Proxied Webhook Verification

The channels webhook handler now accepts `X-Platform-Signature` as an alternative verification method for webhooks forwarded by vobase-platform.

Security hardening: platform signature is only accepted when provider-specific signature headers (`X-Hub-Signature-256`, `Stripe-Signature`) are **absent**. This prevents an attacker who compromised the platform secret from bypassing provider-specific verification on direct webhooks.

## Dual-Mode Integration Token Auto-Refresh

Automatic OAuth token refresh for integrations with two modes:

| Mode | When | How |
|------|------|-----|
| **Local** | Integration config has `clientId` + `clientSecret` + `refreshToken` | Refreshes directly with provider API |
| **Platform** | `PLATFORM_HMAC_SECRET` + `PLATFORM_URL` set | Delegates to vobase-platform token vault |

Built-in provider support:

| Provider Family | Token Endpoint | Providers |
|----------------|---------------|-----------|
| Google | `oauth2.googleapis.com/token` | Google Workspace, Gmail, Google Calendar |
| Microsoft | `login.microsoftonline.com` | Microsoft 365, Outlook, Teams |

Extensible via `registerProviderRefresh(provider, fn)` for custom OAuth providers.

The `integrations:refresh-tokens` job runs every 5 minutes, scanning for tokens expiring within 10 minutes and refreshing them in the appropriate mode.

### New Exports

- `verifyPlatformSignature(rawBody, signature)` — HMAC-SHA256 verification
- `isPlatformEnabled()` — check if platform integration is active
- `getRefreshMode(config)` — returns `'local'` | `'platform'` | `null`
- `registerProviderRefresh(provider, fn)` — register custom provider refresh
- `getProviderRefreshFn(provider)` — get refresh function for a provider

## WhatsApp Configuration Endpoint

`POST /api/integrations/whatsapp/configure` accepts WhatsApp Business API credentials pushed from the platform after Embedded Signup completes. Platform-signed, creates or updates the WhatsApp integration record.

## Template Changes

- Streamlined Dockerfile (removed unused stubs directory copy)
- Refactored db scripts: replaced `db-commit.ts`/`db-current.ts` with cleaner `db-generate.ts`/`db-push.ts`
- Updated `.env.example` with `PLATFORM_HMAC_SECRET` and `PLATFORM_URL`
- Switched from `railway.toml` to `railway.json` for Railway deployment config
- Added template-level `biome.json` extending root config

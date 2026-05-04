# WhatsApp adapter — operator setup

Vobase ships two WhatsApp onboarding flows. Both run through the same channel
adapter (`createWhatsAppAdapter` from `@vobase/core`); they differ only in how
the BISU access token is acquired.

## 1. Manual access-token (legacy / dev)

For local development or single-tenant deployments where the operator already
has a long-lived BISU token, set the legacy env vars:

```
META_WA_TOKEN=...                # BISU access token
META_WA_VERIFY_TOKEN=...         # webhook handshake token
META_WA_PHONE_NUMBER_ID=...
META_WA_APP_ID=...               # optional
META_WA_APP_SECRET=...           # optional, enables HMAC verification
META_WA_API_VERSION=v22.0        # optional, defaults to v22.0
```

The adapter reads these as fallbacks when an instance's `config` is missing
fields. Production tenants should onboard via Embedded Signup (below) instead.

## 2. Embedded Signup (Slice C)

Embedded Signup is Meta's self-onboarding flow. The customer clicks "Connect
WhatsApp" in the Vobase admin UI; Meta opens a popup; the customer authorises
the app; Vobase exchanges the code for a long-lived BISU token, encrypts it
with envelope encryption, and persists it on `channel_instances.config`.

### One-time operator setup per Meta App

In the Meta App Dashboard:

1. **Facebook Login for Business → Settings → Client OAuth Settings** — enable:
   - Login with the JavaScript SDK
   - Use Strict Mode for redirect URIs
   - Embedded Browser OAuth Login
   - Enforce HTTPS
   - Web OAuth Login

   Add every domain Vobase runs on (production + staging) to **Allowed
   Domains** and **Valid OAuth Redirect URIs**. HTTPS only.

2. **Facebook Login for Business → Configurations** — create **two** configs
   (one per onboarding flow):
   - **Cloud API** config — based on the "WhatsApp Embedded Signup
     Configuration With 60 Expiration Token" template. Record the
     Configuration ID.
   - **Coexistence** config — same template, with `featureType:
     'whatsapp_business_app_onboarding'` enabled in the launch payload. Record
     the Configuration ID.

   Both configs request the standard scopes: `whatsapp_business_management`,
   `whatsapp_business_messaging`, `business_management`.

3. **App Review** — submit for `whatsapp_business_management` and
   `whatsapp_business_messaging` Advanced Access. Until approved, only Meta
   test users can complete the flow.

4. **Live mode** — flip the app from Development to Live so real customers
   can complete the flow and webhooks fire.

### Required env vars

Set the following in the deployment env. The frontend reads `appId` +
`configIds` from the `/start` response; it never sees the secret.

```
META_APP_ID=...                         # numeric Facebook App ID
META_APP_SECRET=...                     # NEVER expose to the browser; server-side only
META_APP_CONFIG_ID_CLOUD=...            # Configuration ID from step 2 (cloud)
META_APP_CONFIG_ID_COEXISTENCE=...      # Configuration ID from step 2 (coexistence)
META_APP_API_VERSION=v22.0              # optional, defaults to v22.0
```

`BETTER_AUTH_SECRET` must already be set (≥32 chars) — envelope encryption
derives its KEK from it.

### Flow

```
Browser                        Vobase backend                     Meta
   │                                  │                              │
   ├──POST /signup/start──────────────▶│                              │
   │◀──{ nonce, appId, configIds } ───┤                              │
   │                                  │                              │
   ├──FB.login(configId, mode)─────────────────────────────────────▶│
   │                                  │                              │
   │◀──postMessage WA_EMBEDDED_SIGNUP { code, phoneNumberId, wabaId }┤
   │                                  │                              │
   ├──POST /signup/exchange { code, ids, nonce, mode }─▶│            │
   │                                  ├──POST /oauth/access_token──▶│
   │                                  │◀──{ access_token } ─────────┤
   │                                  ├──GET /debug_token──────────▶│
   │                                  │◀──{ app_id, target_ids } ───┤
   │                                  │ envelope-encrypt token       │
   │                                  │ INSERT channel_instances     │
   │                                  │ enqueue whatsapp:setup       │
   │◀──{ instanceId, displayPhone } ──┤                              │
   │                                  │                              │
   │                                  │ (background)                 │
   │                                  ├──POST /{wabaId}/subscribed_apps──▶│
   │                                  ├──POST /{phoneNumberId}/register──▶│  (cloud only)
   │                                  │ setupStage='active'          │
```

### Security guardrails (enforced by Slice C)

- **CSRF nonce** is bound to `(orgId, sessionId)` from the better-auth session
  cookie. Single-use, 5-minute TTL, atomic `DELETE … RETURNING`. Replay or
  session-mismatch returns 401.
- **`debug_token` validation is mandatory** before persisting any access
  token. We assert (a) `data.app_id === META_APP_ID`, (b) the user-claimed
  `wabaId` is in `granular_scopes[].target_ids`. Without (b), an attacker
  who hijacks the FB.login flow can graft an attacker-controlled WABA onto
  the victim org.
- **Two rate-limit buckets**:
  - 10 SUCCESSFUL upstream exchanges/h per `(userId, orgId)`.
  - 60 validation-FAILURE attempts/min per source IP (separate bucket so a
    low-priv member cannot DoS-lock-out the org admin's success bucket).
  - Both backed by `infra.rate_limits` (Postgres `now()` — survives restarts
    and shared across template instances).
- **Envelope-encrypted at rest**: BISU tokens are AES-256-GCM-wrapped under a
  KEK derived from `BETTER_AUTH_SECRET` via HKDF-SHA256. KEK rotation
  re-wraps DEKs only; payload ciphertext is never re-encrypted.
- **No request bodies are logged.** Set `VOBASE_LOG_MESSAGE_BODIES=1` for
  inbound message body logging during local debugging only.

### Coexistence vs Cloud differences

| Concern | Cloud | Coexistence |
|---------|-------|-------------|
| `extras.featureType` | (omitted) | `whatsapp_business_app_onboarding` |
| Phone number `/register` | Required | Skipped (Business App owns it) |
| Account age requirement | None | ≥ 7 days of Business App usage |
| Business App version | N/A | ≥ 2.24.17 |
| 14-day app-open requirement | N/A | Required, else connection drops |
| Default CTA | Secondary | Primary (SG SMEs are mostly already on the Business App) |

See `.claude/skills/whatsapp-cloud-api/references/coexistence.md` for the full
feature compatibility matrix and gotchas.

### Per-tenant Meta App support

Carl owns the initial Vobase Meta App. Per-tenant Meta App support (each
tenant brings its own App ID + secret) is on the roadmap but not part of
Slice C — every tenant currently shares the configured app.

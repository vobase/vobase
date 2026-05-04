---
"@vobase/core": minor
---

# WhatsApp Channel: Cloud API + Embedded Signup + Platform Sandbox

End-to-end WhatsApp Cloud API support across self-managed (BYOC) and platform-managed (sandbox) modes, including Embedded Signup, coexistence echoes, 24-hour service window enforcement, status FSM, reactions, template lifecycle, and a per-instance doctor. Built on a new `WhatsAppTransportConfig` seam so direct (Meta) and managed (proxied) paths share one adapter.

Ships alongside two new core primitives — envelope-encrypted secrets vault and a sliding-window rate limiter — that the channels work consumes but any module can use.

## WhatsApp Cloud API parity

| Capability | Surface | Notes |
|---|---|---|
| Direct mode (BYOC) | `createDirectTransportConfig({ accessToken, appSecret })` | Tenant holds Meta access token in encrypted integrations vault |
| Managed mode (sandbox) | `createManagedTransportConfig({ platformChannelId, platformBaseUrl, currentSecret, previousSecret? })` | Tenant holds only HMAC pair to vobase-platform — never a Meta token |
| Webhook verify | `WhatsAppTransportConfig.verifyInboundWebhook(req)` | Closes the prior `if (transport) return true` short-circuit; mode-specific verifier |
| 24h service window | `messaging.conversation_sessions` + `outbound.ts` precheck | Returns `SendResult { code: 'window_expired' }` instead of attempting send |
| Status callbacks | `messaging/service/messages.updateDeliveryStatus()` | Strict FSM `queued → sent → delivered → read`; `failed` terminal; never mutates `role`/`content` |
| Reactions | `messaging.message_reactions` + `messaging/service/reactions.ts` | Single-writer; `check:shape` enforced |
| Templates | `templates.ts` CRUD + `vobase channels:templates:sync` | Status pills (APPROVED/PENDING/REJECTED) in admin UI |
| Doctor | `vobase channels:doctor :instanceId` + `<InstanceDoctorSheet>` | Runs `debug_token`, `subscribed_apps`, `phone_numbers`, `message_templates` |
| Coexistence echoes | `parseWhatsAppEchoes` + `dispatchInbound` non-waking path | `role='staff'`, `metadata.echoSource`, no wake, no window open, no `add_note` fan-out |

## Embedded Signup (Cloud + Coexistence)

Server-side OAuth-style signup that meets Meta's "embedded" requirement (code exchange happens on the backend within the 60s code TTL). Supports both:

- **Cloud signup** — full Meta-hosted onboarding, tenant gets a fresh BISU access token, WABA, and phone number.
- **Coexistence signup** — links an existing WhatsApp Business App number; inbound webhooks include `smb_message_echoes` for staff messages typed on the phone.

Backend wiring:

```ts
POST /api/channels/whatsapp/signup/start    // mints (orgId, sessionId)-bound nonce
POST /api/channels/whatsapp/signup/exchange // validates nonce + debug_token, exchanges code → token, creates instance
```

Frontend launcher: `<WhatsAppSignupButton variant="hero" | "compact" />` (Facebook SDK loaded via `src/lib/facebook-sdk.ts`).

Hardening:
- `signup_nonces` table: atomic `DELETE … RETURNING` consume, 5-min expiry, bound to `(orgId, sessionId)` from better-auth session cookie.
- `debug_token` validation **mandatory** before persistence — confirms `app_id` match and that the WABA appears in `granular_scopes[].target_ids`. Failure consumes the nonce (frontend re-`/start`).
- Per-org rate limit: 10 successful exchanges/hour. Separate per-source-IP token bucket (60/min) for validation failures so a low-priv member can't lock out the org admin's success bucket.
- Admin role gating via `getRequireAdmin()` lazy accessor on every signup/managed/doctor mutation route.

## Platform-managed sandbox channels (cross-repo)

For tenants without a Meta Developer App, the platform allocates dedicated sandbox phone numbers from a pool. Tenant config carries only `{ mode: 'managed', platformChannelId, platformBaseUrl }` — zero Meta credentials at rest.

New tenant ↔ platform contract (HMAC sig v2):

```
payload  = `${METHOD}|${pathOnly}|${sortedCanonicalQuery}|${sha256(body)}`
headers  = X-Vobase-Routine-Sig, X-Vobase-Rotation-Sig, X-Vobase-Key-Version,
           X-Vobase-Sig-Version: 2, X-Vobase-Body-Digest, X-Tenant-Id
fallback = X-Platform-Signature (v1, body-unsigned — emitted in parallel during rollout)
```

Platform accepts either by default; flip `MANAGED_REQUIRE_SIG_V2=true` after all tenants confirm v2 traffic. 5-minute rotation grace window verifies against current + previous secret.

TOCTOU-safe `upsertManagedInstance` via Postgres generated column + partial unique index:

```sql
platform_channel_id text GENERATED ALWAYS AS ((config->>'platformChannelId')) STORED
INSERT … ON CONFLICT (platform_channel_id) WHERE platform_channel_id IS NOT NULL …
```

## Channels admin UI revamp

Single unified `<ChannelsTable>` (DiceUI data-table) replaces the prior tile catalog. WhatsApp + Web channels coexist in one row list with a `<ModeChip>` (Self-managed / Platform sandbox / Web embed) per row. Row-action menu opens slide-over sheets for Doctor (WA), Templates (WA), and Embed snippets (Web) — no separate pages, no routing.

Components added:
- `<WhatsAppSignupButton variant="hero" | "compact">` — Facebook SDK launcher
- `<WhatsAppEmptyState>` + `<ConnectWhatsAppSheet>` — first-run flow
- `<TemplatesSheet>` + `<TemplatesTable>` — shared between sheet and dedicated `/channels/templates` page
- `<InstanceDoctorSheet>` + `useInstanceDoctor()` hook — per-instance health probe
- `<WebChannelDetailsSheet>` — embed snippets, bubble preview, install instructions
- `<ChannelRowMenu>` — Doctor / Templates / Embed / Reassign default (placeholder, disabled)

CLI verbs registered:
- `vobase channels:list`
- `vobase channels:instance:show :id`
- `vobase channels:doctor :id`
- `vobase channels:templates:sync :id`

## Core: envelope-encrypted secrets vault

New `@vobase/core/hmac/encrypt` exports:

```ts
encrypt(plaintext, { keyVersion?: number })  // → { ciphertext, kekVersion, dekWrapped, iv, tag }
decrypt({ ciphertext, kekVersion, dekWrapped, iv, tag })  // throws on tag mismatch
```

- AES-256-GCM with envelope encryption (per-row DEK wrapped by versioned KEK).
- KEK derivation: `HKDF-SHA256(BETTER_AUTH_SECRET, salt='vobase-vault-kek-v1', info='kek-v1')`.
- `BETTER_AUTH_SECRET < 32 chars` is **refused at runtime** — production must set this explicitly.
- KEK rotation re-wraps DEKs without rewriting ciphertext rows. `kekVersion` column tracks the wrapping key per row.
- 2-key contract for tenant ↔ platform: `routineSecret` (5-min rotation grace) + `rotationKey` (only authenticates `/api/integrations/token/update`, monotonic `keyVersion` rejects replay).

## Core: sliding-window rate limiter

New `@vobase/core/rate-limits` primitive backed by `core.rate_limits` table:

```ts
const limiter = createRateLimiter(db)
await limiter.consume({ key: `wa:exchange:${orgId}`, limit: 10, windowSeconds: 3600 })
// → { allowed: true, remaining: 9, resetsAt }
```

Used by ESU per-org success limiter and per-source-IP failure bucket. Generic enough for any module — webhook abuse, integration calls, agent tool budgets.

## Core: 2-key HMAC sig v2

`packages/core/src/hmac/index.ts` extended with sig v2 helpers:

- `signRequestV2({ method, path, query, body, currentSecret, rotationKey, keyVersion })` → emits the full v2 header bundle
- `verifyRequestV2({ req, currentSecret, previousSecret?, previousValidUntil?, rotationKey, currentKeyVersion })` → accepts current + previous within grace window; rejects `keyVersion <= currentKeyVersion`

## Frontend bundle isolation

`check:bundle` script extended to also forbid `~/runtime` imports from `src/**`. Prevents backend code (auth handles, db client, jobs) from leaking into the browser bundle. New `tsconfig` path `~/wake/*` distinguishes harness-only modules.

## Drive integration follow-ups

Carry-along from the parallel Drive plan that this work depends on:
- Inbound WhatsApp media auto-ingests into `drive_files` via `MessageReceivedEvent.media[]`.
- `WakeTrigger.caption_ready` fires once OCR extraction completes for an attached file.
- Drive list page gains UI upload, per-row actions, PDF readability gate, OCR provider AI SDK v6 fix, openai SDK v3 bump.

## Repo-wide secret scanning

- `scripts/check-secrets.ts` + `.gitleaks.toml` — pre-commit secret scan with allowlists for fixtures.
- `bun run check:secrets` runs in CI alongside `check:shape`, `check:bundle`, `check:shadcn-overrides`, `check:no-auto-nav-tabs`.

## Bug fixes

- `fix(template/channels)`: TOCTOU race in `upsertManagedInstance` resolved via generated column + partial unique index (B3).
- `fix(template/channels)`: `TRUST_PROXY_HOPS` env var for source-IP determination — defaults to `0` (ignore XFF) for prod safety. Operators behind a sanitizing proxy must set `TRUST_PROXY_HOPS=N` explicitly (SH4).
- `fix(template/channels,integrations)`: admin role gating on managed/finish/doctor/instance mutations via `createRequireRole(db, ['owner','admin'])` (SH3).
- `fix(template/integrations)`: release sends 2-key headers + persists previous pair on first handshake (B4+B5).
- `fix(template/channels)`: restored web embed snippets via `<WebChannelDetailsSheet>` (regression from unified channels table — embed/snippets/bubble-preview now live behind row-action menu, mirroring the WA Doctor/Templates pattern).
- `fix(template/drive)`: unblock upload preview by bumping openai SDK to v3 and remounting the editor on extract.

## Test coverage

- 23 new test files (e2e + integration + unit + smoke):
  - `tests/e2e/messaging-{inbound-attachments,attachment-failure,attachment-orphan,inbound-redelivery,loser-of-race-reap}.test.ts`
  - `tests/e2e/caption-ready-wake.test.ts`
  - `modules/channels/handlers/whatsapp-signup.test.ts` (450 lines, full ESU flow)
  - `modules/channels/adapters/whatsapp/{managed-transport,echoes}.test.ts`
  - `modules/channels/service/{instances,signup-nonces,dispatch-routing}.test.ts`
  - `modules/messaging/service/{sessions,reactions}.test.ts`
  - `runtime/request-ip.test.ts` (TRUST_PROXY_HOPS coverage)
  - `tests/smoke/smoke-wa-{doctor,echo,inbound,templates}-live.test.ts` (env-gated, run via `bun run smoke:wa`)
- 616 passing, 5 skipped, 1 todo. The 6 failures pre-existed on `main` (contacts service not installed in the channels echo test env) — not regressions from this work.

## Operational notes

- **Recommended deploy order:** (1) Push vobase-platform branch + run migration (webhook router has legacy fallback). (2) Push tenant `main` (sends both v1 + v2 sig headers). (3) Monitor sig-v1 vs v2 traffic. (4) Once v1 traffic is zero, set `MANAGED_REQUIRE_SIG_V2=true` on platform.
- **Backfill:** ops needs to populate `tenant_environments` rows for existing managed tenants so the per-env webhook resolver targets the right `instanceUrl`. Falls back gracefully today.
- **Open follow-ups (non-blocking):** `Reassign default…` row action wired but disabled (needs AssigneeSelect popover); `mergeContacts(...)` is a JSDoc-only skeleton; vault `previous` decryption is eager per read (bounded by 60s rotation cache TTL — optional lazy follow-up).

## Dependencies

No new runtime dependencies. The core stays free of crypto/rate-limiter packages — uses Bun's built-in `crypto.subtle` for AES-GCM and Drizzle for the rate-limits table. Facebook SDK loads at runtime in the frontend via `src/lib/facebook-sdk.ts` (no npm install).

---
"@vobase/template": minor
---

# Fix: managed-mode WhatsApp end-to-end wire delivery

Customer messages reaching the agent via the platform-managed WhatsApp sandbox produced agent replies that landed in the inbox UI but never reached the customer's WhatsApp. Diagnosis surfaced two independent bugs at the egress boundary plus three smaller papercuts around sandbox claim ergonomics.

## What changed

### Identity vs. external keys (`@modules/contacts`)

Inbound contact resolution stamped a canonical `${channel}:` prefix onto `contacts.phone` (so `whatsapp:6512345678` instead of `+6512345678`) to keep external keys non-colliding across channels. Outbound dispatch then handed that prefixed value verbatim to `adapter.send({ to })`, and Meta's Graph API silently rejected the malformed recipient — agent reply persisted, wire never fired.

The fix splits identity from per-channel dedup keys.

- **New table** `contacts.contact_external_keys (org_id, channel, external_key, contact_id)` with PK on the triple, index on `contact_id`. Inbound dispatch resolves the contact via this table.
- **`contacts.phone` and `contacts.email` are now bare canonical identity** (E.164 with leading `+`, lowercased RFC email) — no channel prefix. Outbound reads them directly with no stripping.
- **New normalizers** `normalizePhoneE164` (strip non-digits, prepend `+`, length-bound 7–15) and `normalizeEmail` (trim + lowercase) in `modules/contacts/service/identity-normalize.ts`. Light-touch, no `libphonenumber-js` dep — forks that need region-aware validation can compose their own.
- **`upsertByExternal` → `upsertByExternalKey`** with shape `{ organizationId, channel, externalKey, phone?, email?, displayName? }`. Lookup chain: existing key row (single `INNER JOIN`) → existing contact by `phone` or `email` for cross-channel merge → fresh contact + key row. Idempotent key insert with re-fetch handles concurrent inbound races.
- **Inbound dispatch** reads `adapter.contactIdentifierField` to decide whether `event.from` is a phone (normalize → store as `phone` AND key), email, or opaque session token (key only, no phone/email). Adapter resolution now throws on unknown channel instead of silently treating raw `event.from` as the dedup key.

`packages/template/modules/contacts/seed.ts` is unchanged — the seed contacts already used bare `+E.164` phones; the prefix scheme was an inbound-only convention.

### Tenant signing for managed-mode outbound (deferred to platform fix)

The tenant-side outbound signing was correct end-to-end. The platform's `verifyTenantSignature` middleware was using tenant-level HMAC for verification while the platform's own forwarded webhooks used per-channel claim secrets — causing every outbound graph proxy call to 401 with `Invalid signature (v2)`. That asymmetry is fixed in `vobase-platform` (separate commit); no further tenant change required.

### Sandbox-claim ergonomics

- `claim-sandbox-dialog.tsx` no longer gates the "Claim sandbox" button on `availability > 0`. The platform's `allocateManagedChannel` is idempotent on `(tenantSlug, environment, channelInstanceId)` and self-heals orphan claims; gating the click would make those self-heal paths unreachable for any tenant whose `/health` reports zero free slots due to a stale claim row.
- `handshake.ts::fetchSandboxAvailability` now throws `PlatformHandshakeError('platform_unauthenticated')` when the platform's `/health` strips data fields due to HMAC verification failure, instead of returning `{ sandboxPoolAvailable: 0 }` and masquerading as pool exhaustion. The dialog now shows the actual auth-failure reason.
- `channel-row-menu.tsx` web variant now wraps the dropdown trigger in a `flex items-center justify-end` container to match the WhatsApp variant — fixes misaligned menu buttons in the channels table.

### Tests

- New `identity-normalize.test.ts` covers length bounds + null/empty rejection.
- `echoes.test.ts` and `webhook-routing.test.ts` register a stub WhatsApp adapter via the registry now that inbound dispatch hard-errors on missing adapter.
- `wake/workspace/create.test.ts` and `web/tests/inbound.test.ts` updated for the renamed method.

## Migration

Schema changes mean `bun run db:reset` is required after pulling this. There's no in-place migration — projects forked from the template before this should: pull the new `contacts/schema.ts` + `contacts/service/`, run `db:reset`, and re-pull `channels/service/inbound.ts` + `channels/adapters/web/handlers/inbound.ts` to use the new service shape.

## Deferred

- E.164 region-aware normalization (Brazil 12↔13-digit, etc.) — channel adapters with region quirks should compose their own normalizer over `normalizePhoneE164`.
- Cross-channel merge race window — relies on the existing `(orgId, phone)` unique index surfacing as a hard error if two concurrent inbounds race to create the same contact. Closing the window cleanly would need a wrapping transaction with `SELECT ... FOR UPDATE`; out of scope for a scaffold.
- Contact form normalizer divergence — `contact-form-dialog.tsx` still trims raw input; aligning with `normalizePhoneE164` would close a future-state where a form-entered phone could mismatch an inbound-resolved phone for the same person.

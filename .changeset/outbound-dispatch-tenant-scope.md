---
"@vobase/template": patch
---

# Fix: outbound dispatch + media + tenant scope

Agent replies (`reply`, `send_card`, `send_file`) and staff replies were persisted to the inbox but never reached the wire — both owned and managed (platform-proxy) WhatsApp. The web channel masked the bug because its `send()` is a no-op (the realtime push from the row insert delivers to browsers, but no Graph API call is ever made for WhatsApp).

## What changed

### `sendOutbound` seam wired end-to-end

A new install-time service (`installOutboundService`, mirroring the `installMessagesService` pattern) is the single seam for outbound delivery. After persisting their message row, `reply.ts`, `send-card.ts`, `send-file.ts`, and `staff-reply.ts` now call `sendOutbound`, which resolves the channel adapter via the registry, enforces the 24h messaging window for windowed channels, and calls `adapter.send()`.

Adapter resolution is **instance-keyed** — `registryGet(channel, config, instance.id)` — which is what makes managed-mode WhatsApp actually deliver. The managed adapter is constructed bound to the instance's vault rotation so the platform proxy receives correctly-signed requests.

### Cross-tenant assertion

`SendOutboundInput` now requires `organizationId`. Inside `sendOutbound`, every conversation/contact/instance lookup asserts `row.organizationId === input.organizationId` before proceeding. Closes a cross-tenant exfiltration primitive: a wake on `org-A` could previously pass a `conversationId` from `org-B` (e.g. via prompt injection in customer content) and reach `org-B`'s wire signed with `org-B`'s vault keys.

### Channel-aware recipient

The previous `contact.phone ?? contact.email ?? contact.id` fallback could send a nanoid as the wire address. `sendOutbound` now reads `adapter.contactIdentifierField` and throws cleanly if the contact lacks the required handle for that channel — no more silent message-loss for contacts missing a phone number.

### Real media support for `send_file`

`send_file` now resolves the drive row via `filesServiceFor(orgId).get(driveFileId)`, downloads bytes via `getDriveStorage().bucket('drive').download(storageKey)`, maps the mime type to `image | video | audio | document`, and ships a real `OutboundMessage.media[]` payload. The WhatsApp adapter's existing bytes-upload path (`sendMedia` → Graph `/PHONE_ID/media` → upload id) handles the rest.

A scope check rejects sending another contact's private file: the drive file must be `organization`-scoped, or `contact`-scoped to the conversation's contact, or `agent`-scoped to the current agent. Closes a within-tenant lateral-access path where prompt injection from contact-X could leak contact-Y's private upload from the same org.

Virtual files (no `storageKey`, e.g. `MEMORY.md` overlays) throw cleanly.

### `SendResult` failures surface to the agent

A new `throwIfFailed(result, toolName)` helper bubbles `success: false` outcomes out of every tool. `code === 'window_expired'` throws with a template-fallback hint (`Messaging window expired — fall back to a pre-approved template`); other failures bubble `code` + `error`. Replaces the silent `await sendOutbound(...)` that swallowed Graph 5xx and window-expired short-circuits.

### Declarative per-adapter platform hints

Each channel adapter now owns its prompt hint alongside `agent.ts`:

| Adapter | Export |
|---|---|
| `modules/channels/adapters/web/agent.ts` | `webPlatformHint` |
| `modules/channels/adapters/whatsapp/agent.ts` | `whatsappPlatformHint` |

The umbrella `modules/channels/agent.ts` aggregates `platformHints: HarnessPlatformHint[]`, and `wake/platform-hints.ts` is now a thin registry built from that list. Adding a new channel adapter only touches its own folder. Vestigial `email`/`sms`/`voice` entries removed since no adapters back them today — re-add them in their adapter folder when wired.

## Tests

Test stubs for the four sender paths now use counted-spy fakes that assert `sendOutbound` was called with the right `(toolName, organizationId, conversationId)`. A regression test for `window_expired` confirms the failure-path bubbles a tool error mentioning the template fallback. A regression on the wire path can no longer pass.

## Migration

No schema changes. No new dependencies. No new pg-boss jobs. The `installOutboundService` call lands in `modules/channels/module.ts::init` — projects scaffolded from this template before this fix should re-pull the channels module init or call `installOutboundService(createOutboundService())` themselves at boot.

`ChannelOutboundEventSchema` was removed from `runtime/channel-events.ts` (no remaining consumers); inbound schema and `OUTBOUND_TOOL_NAMES` retained.

## Deferred

The following were intentionally scoped out and remain follow-ups:

- `send_card` → real WhatsApp interactive payload (buttons / list pickers); currently flattens to plain text.
- `messages.status` state machine (`queued → sent → failed`) + delivery retry queue.
- E.164 normalization on WhatsApp `to:` at the egress boundary.
- Managed-mode env-fallback regression-guard (a config row that loses `mode: 'managed'` currently falls back to env-var creds).
- `runThreatScan` is still a `return { ok: true }` stub on the `send_file` path.
- `staff_reply` attachments persist on the row but only the text body flows to the wire.
- `installOutboundService` cross-test bleed sweep (pre-existing pattern across all `install*` services).

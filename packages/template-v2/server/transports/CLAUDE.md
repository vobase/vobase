## modules/channels/

Channel adapters that connect external messaging surfaces to the messaging. Each subdirectory is a full module conforming to the standard shape, plus a `port.ts` that implements `V2ChannelAdapter` — channels are the one place `port.ts` still earns its keep (multiple real implementations: web, whatsapp, future).

**What channels are.** Channels implement `V2ChannelAdapter` (which refines core's `ChannelAdapter`). They own inbound webhook reception, HMAC verification, and outbound dispatch — nothing more. All conversation writes go through the messaging service (`appendTextMessage`, `appendCardMessage`, …); channels never touch DB tables directly.

**What channels are not.** Channels are not business surfaces. They have no user-facing pages of their own. Settings UI (e.g. WhatsApp token config) lives in the `settings` module. HTTP mount paths (`/api/channel-web`, `/api/channel-whatsapp`) are external surfaces registered with providers (Meta, etc.) and must not change — they are decoupled from the file layout here.

**Transport-only rule (A3).** `service/dispatcher.ts` (web) and `service/sender.ts` (whatsapp) must NEVER import drizzle or write to DB. They are pure HTTP delivery. All state writes happen upstream in `handlers/inbound.ts` / `handlers/card-reply.ts` via the messaging service. `modules/channels/web/tests/dispatcher-transport-only.test.ts` guards this at CI — the test fails on any drizzle import or db handle in the dispatcher. Keep the write path one-way: handler writes state, dispatcher/sender delivers bytes.

**Outbound switch coupling.** When you add a new outbound tool name to `server/contracts/channel-event.ts::OUTBOUND_TOOL_NAMES`, you must also add it to the switch in BOTH `web/service/dispatcher.ts` and `whatsapp/service/sender.ts` — otherwise outbound delivery silently drops on that transport.

**Card-reply round trip (web).** Browser taps a card button → `POST /api/channel-web/card-reply` → messaging service `sendCardReply()` writes `kind='card_reply'` + a `channel_inbound` event atomically → wake scheduler notifies. Never write `messages` directly from the handler — always through the messaging service.

**WhatsApp specifics.**
- Opt-in via `META_WA_TOKEN` + `META_WA_VERIFY_TOKEN`; `module.ts` no-ops init if disabled so the rest of the app still boots.
- Webhook verification: `handlers/webhook-verify.ts` answers Meta's `GET hub.challenge` if `hub.verify_token` matches env. `handlers/webhook-event.ts` delegates `X-Hub-Signature-256` HMAC checking to `verifyHmacWebhook` from `@server/middlewares` with `devBypass: true` (matches Meta's validation dance when no secret is wired up in dev). Skipping either is a security hole.
- Media URLs expire in 5 minutes. Inbound media triggers a download job immediately in `jobs.ts`. If the job fails, the media is lost — keep the job retry budget tight.
- Staff consultation channel: also sends out `@staff:<id>` internal-note notifications. Staff's WA reply correlates back via `notif_channel_msg_id` → fires `supervisor` wake trigger with the note. Messaging owns the semantics; whatsapp is the pipe.

**Signature header format.** `parseHubSignature(c)` strips the `sha256=` prefix if present. Both Meta and our channel-web webhook use `X-Hub-Signature-256`; channel-web's client signs raw hex, Meta signs with the `sha256=` prefix. Same parser handles both.

**Adding a new channel.** Drop a folder (`modules/channels/<name>/`) that follows the module shape, add `port.ts` implementing `V2ChannelAdapter`, register it in `vobase.config.ts` after the existing channel entries. `check:shape` auto-discovers all subdirectories of `modules/channels/`.

**Currently shipped:**
- `web/` — browser widget channel (always enabled)
- `whatsapp/` — WhatsApp Cloud API (opt-in via env above)

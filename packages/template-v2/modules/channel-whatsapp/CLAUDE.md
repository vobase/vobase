## modules/channel-whatsapp/

WhatsApp Business Cloud adapter. Opt-in via `META_WA_TOKEN` + `META_WA_VERIFY_TOKEN`; `module.ts` no-ops init if disabled so the rest of the app still boots.

**Transport-only rule (A3).** Same as channel-web: `service/sender.ts` must NEVER import drizzle or write DB. It only calls the WhatsApp Cloud API over HTTP. Guarded by the A3 pattern — keep it transport.

**Webhook verification.** `handlers/webhook-verify.ts` answers Meta's `GET hub.challenge` if `hub.verify_token` matches env. `handlers/webhook-event.ts` verifies `X-Hub-Signature-256` HMAC (see `server/runtime/hub-signature.ts`) before parsing. Skipping either is a security hole — Meta re-delivers without auth.

**Media URLs expire in 5 minutes.** Inbound media triggers a download job immediately in `jobs.ts`. If the job fails, the media is lost — keep the job retry budget tight.

**Outbound switch coupling.** `OUTBOUND_TOOL_NAMES` in `server/contracts/channel-event.ts` must match the switch in `service/sender.ts`. New outbound tools that aren't added here silently drop.

**Staff consultation channel.** This adapter also sends out `@staff:<id>` internal-note notifications. Staff's WA reply correlates back via `notif_channel_msg_id` → fires `supervisor` wake trigger with the note. The inbox module owns the semantics; the whatsapp module is the pipe.

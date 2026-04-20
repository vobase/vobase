## modules/channels/

Channel adapters that connect external messaging surfaces to the inbox. Each subdirectory is a full module conforming to the standard shape (`module.ts`, `manifest.ts`, `schema.ts`, `handlers/index.ts`, `port.ts`, `README.md`).

**What channels are.** Channels implement `V2ChannelAdapter` (which refines core's `ChannelAdapter`). They own inbound webhook reception, HMAC verification, and outbound dispatch — nothing more. All conversation writes go through `InboxPort`; channels never touch DB tables directly (A3 invariant: `service/dispatcher.ts` and `sender.ts` must not import drizzle).

**What channels are not.** Channels are not business surfaces. They have no user-facing pages of their own. Settings UI (e.g. WhatsApp token config) lives in the `settings` module or is contributed via module registration. HTTP mount paths (`/api/channel-web`, `/api/channel-whatsapp`) are external surfaces registered with providers (Meta, etc.) and must not change — they are decoupled from the file layout here.

**Adding a new channel.** Drop a folder here (`modules/channels/<name>/`) that follows the module shape. Register it in `vobase.config.ts` after the existing channel entries. The `check:shape` script automatically discovers all subdirectories of `modules/channels/`.

**Currently shipped:**
- `web/` — browser widget channel (always enabled)
- `whatsapp/` — WhatsApp Cloud API (opt-in via `META_WA_TOKEN` + `META_WA_VERIFY_TOKEN`)

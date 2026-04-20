## modules/channel-web/

Web chat adapter. Always enabled.

**Transport-only rule (A3).** `service/dispatcher.ts` and `service/state.ts` must NEVER import drizzle, NEVER write to DB. They are pure HTTP delivery. All state writes happen upstream in `handlers/inbound.ts` / `handlers/card-reply.ts` via `InboxPort`. `tests/dispatcher-transport-only.test.ts` guards this at CI — the test fails if the dispatcher imports `drizzle-orm` or touches a db handle.

**Why.** The dispatcher is the only place that talks to the browser; if it writes DB, you get double-write bugs (the handler already wrote via InboxPort) and make testing the transport impossible in isolation. Keep the write path one-way: handler writes state, dispatcher delivers bytes.

**Outbound switch coupling.** When you add a new outbound tool name to `server/contracts/channel-event.ts::OUTBOUND_TOOL_NAMES`, you must also add it to the switch in `service/dispatcher.ts` or it silently drops. Keep both in sync.

**Card-reply round trip.** Browser taps a card button → `POST /api/channel-web/card-reply` → `InboxPort.sendCardReply()` writes `kind='card_reply'` + a `channel_inbound` event atomically → wake scheduler notifies. Never write `messages` directly from the handler — always through `InboxPort`.

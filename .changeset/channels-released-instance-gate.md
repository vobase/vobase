---
'@vobase/template': patch
---

fix(channels): drop inbound events targeting released channel instances

Released rows stay in the DB to preserve `fk_conv_channel_instance`, but every webhook ingress was happily resolving them and persisting new inbound. When a tenant disconnects a WhatsApp channel, Meta keeps delivering webhooks until subscribe_apps is cleaned up — those events were landing on the released row as if it were still active.

- `handlers/webhook.ts` (generic provider webhook — WABA lands here): return 404 on both GET (challenge) and POST when `status === 'released'`.
- `adapters/web/handlers/inbound.ts`: look up the instance up-front and reject with 410 `channel_released` so widgets can't push to a disconnected channel.
- `service/inbound.ts::dispatchInbound`: belt-and-suspenders — warn-log and return `[]` if the resolved instance is released, so any future ingress path that forgets the handler check still can't leak.

The managed-channel router already gated on `status === 'active'`.

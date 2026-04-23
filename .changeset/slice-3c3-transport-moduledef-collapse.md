---
'@vobase/template-v2': patch
---

Collapse the `ModuleDef` wrapper around channel transports (slice 3c.3).

Channel-web and channel-whatsapp no longer register through the `ModuleDef { name, requires, routes, init }` path. They now expose plain factory functions (`createChannelWebTransport`, `createChannelWhatsappTransport`) that `server/app.ts` calls directly after `bootModulesCollector` finishes. Init ordering is preserved by line sequence rather than `requires:` edges.

- Deleted: `server/transports/web/module.ts`, `server/transports/whatsapp/module.ts`.
- Added: `server/transports/web/index.ts`, `server/transports/whatsapp/index.ts` — plain factories returning `{ name, handlers }`.
- `vobase.config.ts#modules` is down to the 6 domain modules (settings, contacts, team, drive, messaging, agents); transports no longer appear there.
- Mount paths `/api/channel-web/*` and `/api/channel-whatsapp/*` are unchanged — external webhook contracts are untouched.

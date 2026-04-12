---
"@vobase/core": minor
---

Add transport abstraction to WhatsApp adapter for managed channels

- `WhatsAppTransportConfig` interface: route all Graph API calls through a proxy instead of calling Meta directly
- `transportFetch` closure: centralized URL construction, HMAC signing (method+path), proxy error interception
- Media download proxy: dedicated endpoint for binary CDN downloads with Bearer auth
- Instance-ID keyed adapter resolution: `channels.getAdapter(instanceId) ?? channels.getAdapter(type)`
- `unregisterAdapter()` on ChannelsService for managed channel disconnect
- `signPlatformRequest()` export for tenant→platform HMAC signing
- Extracted shared webhook parsing to `whatsapp-shared.ts`
- Full feature parity with direct channels (media, reactions, read receipts, template sync)

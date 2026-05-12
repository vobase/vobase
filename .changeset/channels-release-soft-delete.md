---
'@vobase/template': patch
---

fix(template/channels): release sandbox via managed endpoint + soft-delete instead of hard

Releasing a sandbox WhatsApp channel from the UI returned 500 because the
WhatsApp row menu's delete button called the generic
`DELETE /api/channels/instances/:id` — which doesn't release the
platform-side `managed_whatsapp_channel_claims` row, and hits
`fk_conv_channel_instance` (`ON DELETE RESTRICT`) the moment a conversation
has routed through this channel. The intent in the existing dialog copy is
already "Existing conversations are preserved but no new messages will be
received", so this switches the contract to soft-delete:

- `service/instances.ts::remove` now flips `status` to a new
  `RELEASED_STATUS = 'released'` sentinel instead of hard-deleting.
  `list()` filters those rows out so they neither surface in the channels
  listing nor short-circuit the managed-claim idempotency probe.
- `channel-row-menu.tsx` dispatches managed channels to the dedicated
  `DELETE /api/channels/whatsapp/managed/:instanceId` so the platform
  claim release runs before the tenant-side soft-delete; self channels
  still use the generic path (now also soft-delete).

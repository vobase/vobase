---
'@vobase/template': patch
---

fix(messaging): inbox now refreshes on customer inbound + optimistic staff reply

Two inbox UX gaps:

1. **Customer messages didn't surface until the agent replied.** The web
   adapter already fanned out an SSE `notifyConversation` post-write
   (`adapters/web/handlers/inbound.ts`), but the generic
   `modules/channels/service/inbound.ts` — used by every other adapter,
   including WhatsApp — did not. The staff inbox then waited on the wake's
   own `tool_execution_end` notify, which could be seconds away (and never
   fires if the agent no-ops). Added the same post-write
   `notifyConversation(result.conversation.id)` call to the generic
   inbound path so every channel surfaces customer messages immediately.

2. **No optimistic update when replying from the inbox.** `useStaffReply`
   only invalidated `['messages', …]` `onSuccess`, so the staff bubble
   appeared only after the server roundtrip. The hook now prepends a
   sentinel `Message` (id: `optimistic-${ts}`, status: `'sending'`,
   metadata: `{ optimistic: true }`) on `onMutate`, restores the snapshot
   on error, and invalidates on `onSettled` so the real row replaces the
   sentinel as soon as the server response arrives.

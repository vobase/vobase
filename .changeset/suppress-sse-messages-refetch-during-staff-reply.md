---
'@vobase/template': patch
---

fix(messaging): suppress SSE messages refetch during pending staff-reply

The optimistic reply bubble appeared correctly on `onMutate`, but the
SSE-driven `conversations`-table notify (fired by the reply handler's own
`notifyConversation`) raced the mutation's HTTP response: the resulting
`['messages', conversationId]` refetch replaced the optimistic row with
the persisted one mid-flight. Because the optimistic id (`optimistic-…`)
differs from the server-issued id, React re-keyed the row, AI-elements
`Conversation` (`use-stick-to-bottom`) observed the resize, and the
bubble visibly bounced with a one-frame gap.

- `useStaffReply` now sets `mutationKey: ['staff-reply', conversationId]`
  (exported as `STAFF_REPLY_MUTATION_KEY`).
- `useRealtimeInvalidation` checks
  `isMutating({ mutationKey: ['staff-reply', payload.id] })` before
  invalidating `['messages', payload.id]` on a `conversations` notify,
  deferring to the mutation's own `onSettled` for the final reconcile.

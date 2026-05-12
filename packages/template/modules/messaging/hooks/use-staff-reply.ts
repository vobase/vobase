import { useMutation, useQueryClient } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'
import type { Message } from '../schema'

/**
 * Staff reply with optimistic update. The composer clears its textarea
 * synchronously on submit; here we prepend a sentinel `Message` to every
 * cached `['messages', conversationId, …]` list so the bubble appears
 * immediately, then invalidate on settle so the real row (with server-side
 * id, journaled timestamps, and any post-write side effects) replaces it.
 *
 * The optimistic row carries `status: 'sending'` for any future composer-side
 * affordance; downstream renderers (`MessageThread → SharedMessageRow`) read
 * `role`/`kind`/`content` and don't depend on the status column for layout.
 */
/**
 * Stable mutation-key prefix. The realtime invalidation hook checks
 * `isMutating({ mutationKey: [STAFF_REPLY_MUTATION_KEY, conversationId] })`
 * to skip its SSE-driven `messages` refetch while a staff reply is in
 * flight — that refetch would otherwise replace the optimistic row with
 * the real one mid-mutation, causing the bubble to disappear for one frame
 * before reappearing under a new React key.
 */
export const STAFF_REPLY_MUTATION_KEY = 'staff-reply'

export function useStaffReply(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: [STAFF_REPLY_MUTATION_KEY, conversationId],
    mutationFn: async (body: string) => {
      const r = await messagingClient.conversations[':id'].reply.$post({
        param: { id: conversationId },
        json: { body },
      })
      if (!r.ok) throw new Error(`staff reply failed: ${r.status}`)
      return r.json()
    },
    onMutate: async (body) => {
      // Cancel in-flight refetches so they don't clobber the optimistic row
      // between our `setQueryData` and the eventual `invalidateQueries`.
      await qc.cancelQueries({ queryKey: ['messages', conversationId] })

      const previous = qc.getQueriesData<Message[]>({
        queryKey: ['messages', conversationId],
      })

      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        conversationId,
        // `Message.organizationId` is denorm; cache rows arrive with the real
        // value on invalidate, so an empty string suffices for the brief
        // optimistic window — no renderer reads it.
        organizationId: '',
        role: 'staff',
        kind: 'text',
        content: { text: body },
        parentMessageId: null,
        channelExternalId: null,
        status: 'sending',
        attachments: [],
        metadata: { optimistic: true },
        createdAt: new Date(),
      }

      qc.setQueriesData<Message[]>({ queryKey: ['messages', conversationId] }, (rows) =>
        rows ? [...rows, optimistic] : rows,
      )

      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      // Restore every cached list we mutated. `setQueryData` is keyed by the
      // exact key, so we replay the captured `getQueriesData` snapshot.
      if (!ctx) return
      for (const [key, data] of ctx.previous) {
        qc.setQueryData(key, data)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
    },
  })
}

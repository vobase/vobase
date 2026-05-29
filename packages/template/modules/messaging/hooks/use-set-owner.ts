import { useMutation, useQueryClient } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'

/**
 * Set (or clear, with `null`) the conversation's owner — the staff member in
 * charge. Distinct from `useReassign`, which changes the responder (`assignee`);
 * setting an owner never silences the agent.
 */
export function useSetOwner(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ownerUserId: string | null) => {
      const r = await messagingClient.conversations[':id']['set-owner'].$post({
        param: { id: conversationId },
        json: { ownerUserId },
      })
      if (!r.ok) throw new Error(`set-owner failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
  })
}

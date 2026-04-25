import { useMutation, useQueryClient } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'

export function useReassign(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assignee: string) => {
      const r = await messagingClient.conversations[':id'].reassign.$post({
        param: { id: conversationId },
        json: { assignee },
      })
      if (!r.ok) throw new Error(`reassign failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
  })
}

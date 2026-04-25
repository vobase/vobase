import { useMutation, useQueryClient } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'

export function useStaffReply(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: string) => {
      const r = await messagingClient.conversations[':id'].reply.$post({
        param: { id: conversationId },
        json: { body },
      })
      if (!r.ok) throw new Error(`staff reply failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
    },
  })
}

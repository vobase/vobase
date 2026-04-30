import { useQuery } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'
import type { Message } from '../schema'

export function useMessages(conversationId: string, limit = 50) {
  return useQuery({
    queryKey: ['messages', conversationId, { limit }],
    queryFn: async (): Promise<Message[]> => {
      const r = await messagingClient.conversations[':id'].messages.$get({
        param: { id: conversationId },
        query: { limit: String(limit) },
      })
      if (!r.ok) throw new Error(`fetch messages failed: ${r.status}`)
      return (await r.json()) as unknown as Message[]
    },
    enabled: Boolean(conversationId),
  })
}

import { useQuery } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'
import type { InternalNote } from '../schema'

export function useNotes(conversationId: string) {
  return useQuery({
    queryKey: ['notes', conversationId],
    queryFn: async (): Promise<InternalNote[]> => {
      const r = await messagingClient.conversations[':id'].notes.$get({ param: { id: conversationId } })
      if (!r.ok) throw new Error(`fetch notes failed: ${r.status}`)
      return (await r.json()) as unknown as InternalNote[]
    },
    enabled: Boolean(conversationId),
  })
}

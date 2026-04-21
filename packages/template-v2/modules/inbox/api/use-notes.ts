import { useQuery } from '@tanstack/react-query'
import type { InternalNote } from '../schema'

export function useNotes(conversationId: string) {
  return useQuery({
    queryKey: ['notes', conversationId],
    queryFn: async (): Promise<InternalNote[]> => {
      const r = await fetch(`/api/inbox/conversations/${conversationId}/notes`)
      if (!r.ok) throw new Error(`fetch notes failed: ${r.status}`)
      return (await r.json()) as InternalNote[]
    },
    enabled: Boolean(conversationId),
  })
}

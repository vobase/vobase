import { useQuery } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'

export interface ActivityEvent {
  id: string
  conversationId: string
  ts: string
  type: string
  payload: Record<string, unknown>
}

export function useActivity(conversationId: string) {
  return useQuery({
    queryKey: ['activity', conversationId],
    queryFn: async (): Promise<ActivityEvent[]> => {
      if (!conversationId) return []
      const r = await messagingClient.conversations[':id'].activity.$get({ param: { id: conversationId } })
      if (!r.ok) throw new Error(`activity.list failed: ${r.status}`)
      return (await r.json()) as unknown as ActivityEvent[]
    },
    enabled: Boolean(conversationId),
  })
}

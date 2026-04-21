import { useQuery } from '@tanstack/react-query'

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
      const r = await fetch(`/api/inbox/conversations/${encodeURIComponent(conversationId)}/activity`)
      if (!r.ok) throw new Error(`activity.list failed: ${r.status}`)
      return r.json()
    },
    enabled: Boolean(conversationId),
  })
}

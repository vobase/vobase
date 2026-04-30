import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { teamClient } from '@/lib/api-client'

export interface UnreadMention {
  noteId: string
  conversationId: string
  authorType: 'agent' | 'staff' | 'system'
  authorId: string
  body: string
  createdAt: string
}

export function useUnreadMentionCount() {
  return useQuery({
    queryKey: ['team', 'mentions', 'unread-count'],
    queryFn: async (): Promise<number> => {
      const r = await teamClient.mentions.unread.count.$get()
      if (!r.ok) throw new Error(`mentions.count failed: ${r.status}`)
      const json = (await r.json()) as unknown as { count: number }
      return json.count
    },
    refetchInterval: 30_000,
  })
}

export function useUnreadMentions() {
  return useQuery({
    queryKey: ['team', 'mentions', 'unread'],
    queryFn: async (): Promise<UnreadMention[]> => {
      const r = await teamClient.mentions.unread.$get()
      if (!r.ok) throw new Error(`mentions.list failed: ${r.status}`)
      return (await r.json()) as unknown as UnreadMention[]
    },
  })
}

export function useDismissMention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (noteId: string) => {
      const r = await teamClient.mentions[':noteId'].dismiss.$post({ param: { noteId } })
      if (!r.ok) throw new Error(`mentions.dismiss failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team', 'mentions'] })
    },
  })
}

export function useDismissAllMentions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await teamClient.mentions['dismiss-all'].$post()
      if (!r.ok) throw new Error(`mentions.dismiss-all failed: ${r.status}`)
      return (await r.json()) as unknown as { ok: true; dismissed: number }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team', 'mentions'] })
    },
  })
}

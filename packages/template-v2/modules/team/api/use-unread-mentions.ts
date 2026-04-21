import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
      const r = await fetch('/api/team/mentions/unread/count')
      if (!r.ok) throw new Error(`mentions.count failed: ${r.status}`)
      const json = (await r.json()) as { count: number }
      return json.count
    },
    refetchInterval: 30_000,
  })
}

export function useUnreadMentions() {
  return useQuery({
    queryKey: ['team', 'mentions', 'unread'],
    queryFn: async (): Promise<UnreadMention[]> => {
      const r = await fetch('/api/team/mentions/unread')
      if (!r.ok) throw new Error(`mentions.list failed: ${r.status}`)
      return r.json()
    },
  })
}

export function useDismissMention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (noteId: string) => {
      const r = await fetch(`/api/team/mentions/${encodeURIComponent(noteId)}/dismiss`, { method: 'POST' })
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
      const r = await fetch('/api/team/mentions/dismiss-all', { method: 'POST' })
      if (!r.ok) throw new Error(`mentions.dismiss-all failed: ${r.status}`)
      return r.json() as Promise<{ ok: true; dismissed: number }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team', 'mentions'] })
    },
  })
}

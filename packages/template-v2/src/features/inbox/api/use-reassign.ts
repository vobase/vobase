import { useMutation, useQueryClient } from '@tanstack/react-query'

export function useReassign(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assignee: string) => {
      const r = await fetch(`/api/inbox/conversations/${conversationId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee }),
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

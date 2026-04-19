import { useMutation, useQueryClient } from '@tanstack/react-query'

export function useSendNote(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: string) => {
      const r = await fetch(`/api/inbox/conversations/${conversationId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, authorType: 'staff', authorId: 'staff' }),
      })
      if (!r.ok) throw new Error(`send note failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
    },
  })
}

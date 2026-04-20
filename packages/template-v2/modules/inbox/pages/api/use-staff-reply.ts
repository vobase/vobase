import { useMutation, useQueryClient } from '@tanstack/react-query'

export function useStaffReply(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: string) => {
      const r = await fetch(`/api/inbox/conversations/${conversationId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!r.ok) throw new Error(`staff reply failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
    },
  })
}

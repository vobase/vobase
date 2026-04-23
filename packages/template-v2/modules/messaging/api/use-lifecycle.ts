import { useMutation, useQueryClient } from '@tanstack/react-query'

type LifecycleAction = 'resolve' | 'reopen' | 'reset'

export function useLifecycle(conversationId: string, action: LifecycleAction, by: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/messaging/conversations/${conversationId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ by }),
      })
      if (!r.ok) throw new Error(`${action} failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
  })
}

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'

type LifecycleAction = 'resolve' | 'reopen' | 'reset'

export function useLifecycle(conversationId: string, action: LifecycleAction, by: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const arg = { param: { id: conversationId }, json: { by } }
      const r =
        action === 'resolve'
          ? await messagingClient.conversations[':id'].resolve.$post(arg)
          : action === 'reopen'
            ? await messagingClient.conversations[':id'].reopen.$post(arg)
            : await messagingClient.conversations[':id'].reset.$post(arg)
      if (!r.ok) throw new Error(`${action} failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
  })
}

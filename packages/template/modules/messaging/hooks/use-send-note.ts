import { useMutation, useQueryClient } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'

export interface SendNoteInput {
  body: string
  mentions?: string[]
}

export function useSendNote(conversationId: string, authorId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SendNoteInput | string) => {
      if (!authorId) throw new Error('send note failed: no authenticated user')
      const { body, mentions } = typeof input === 'string' ? { body: input, mentions: undefined } : input
      const r = await messagingClient.conversations[':id'].notes.$post({
        param: { id: conversationId },
        json: { body, authorType: 'staff', authorId, mentions },
      })
      if (!r.ok) throw new Error(`send note failed: ${r.status}`)
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
      qc.invalidateQueries({ queryKey: ['notes', conversationId] })
    },
  })
}

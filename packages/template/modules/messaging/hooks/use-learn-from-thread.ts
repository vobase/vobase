import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { messagingClient } from '@/lib/api-client'

interface LearnResult {
  agentId: string
  windowCount: number
  messageCount: number
}

/**
 * Triggers a manual "learn from this thread" pass. The backend resolves the
 * agent, chunks the conversation into windows, and enqueues a triage job per
 * window; resulting candidates surface in the agent's next wake.
 */
export function useLearnFromThread(conversationId: string) {
  return useMutation({
    mutationFn: async (): Promise<LearnResult> => {
      const r = await messagingClient.conversations[':id'].learn.$post({
        param: { id: conversationId },
        json: {},
      })
      if (!r.ok) {
        let reason = `learn failed: ${r.status}`
        try {
          const body = (await r.json()) as { message?: string }
          if (body?.message) reason = body.message
        } catch {
          // non-JSON error body — keep the status-based message
        }
        throw new Error(reason)
      }
      return (await r.json()) as LearnResult
    },
    onSuccess: (data) => {
      if (data.windowCount === 0) {
        toast('Nothing to learn from', { description: 'This conversation has no messages yet.' })
        return
      }
      toast('Learning from this thread', {
        description: `Queued ${data.windowCount} window${data.windowCount === 1 ? '' : 's'} over ${data.messageCount} message${data.messageCount === 1 ? '' : 's'}. Candidates will appear in the agent's next wake.`,
      })
    },
    onError: (e) => {
      toast('Could not start learning', {
        description: e instanceof Error ? e.message : 'Unexpected error',
      })
    },
  })
}

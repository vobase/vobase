import type { QueryClient } from '@tanstack/react-query'

/** Canonical set of query keys to invalidate when any conversation changes. */
export function invalidateConversationLists(
  queryClient: QueryClient,
  opts?: { contactId?: string; conversationId?: string },
) {
  queryClient.invalidateQueries({ queryKey: ['conversations-attention'] })
  queryClient.invalidateQueries({ queryKey: ['conversations-active'] })
  queryClient.invalidateQueries({ queryKey: ['conversations-resolved'] })
  queryClient.invalidateQueries({ queryKey: ['conversations-counts'] })
  if (opts?.contactId) {
    queryClient.invalidateQueries({
      queryKey: ['contact-timeline', opts.contactId],
    })
  }
  if (opts?.conversationId) {
    queryClient.invalidateQueries({
      queryKey: ['conversation-detail', opts.conversationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['conversations-messages', opts.conversationId],
    })
    queryClient.invalidateQueries({
      queryKey: ['conversation-labels', opts.conversationId],
    })
  }
}

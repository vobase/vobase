import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { messagingClient } from '@/lib/api-client'
import { invalidateConversationLists } from '../../../lib/invalidate-conversations'

// ─── Data fetchers ───────────────────────────────────────────────────

async function sendReply(conversationId: string, content: string, isInternal = false): Promise<unknown> {
  const res = await messagingClient.conversations[':id'].reply.$post(
    { param: { id: conversationId } },
    {
      init: {
        body: JSON.stringify({ content, isInternal }),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  )
  if (!res.ok) throw new Error('Failed to send reply')
  return res.json()
}

async function createNewConversation(
  contactId: string,
  channelInstanceId: string,
  content: string,
  isInternal: boolean,
): Promise<{ conversationId: string; messageId: string }> {
  const res = await messagingClient.contacts[':id']['new-conversation'].$post(
    { param: { id: contactId } },
    {
      init: {
        body: JSON.stringify({ channelInstanceId, content, isInternal }),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  )
  if (!res.ok) throw new Error('Failed to create conversation')
  return res.json() as Promise<{
    conversationId: string
    messageId: string
  }>
}

async function updateConversation(
  id: string,
  body: {
    status?: 'resolved' | 'failed'
    priority?: 'low' | 'normal' | 'high' | 'urgent' | null
    assignee?: string | null
    onHold?: boolean
  },
): Promise<unknown> {
  const res = await messagingClient.conversations[':id'].$patch(
    { param: { id } },
    {
      init: {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  )
  if (!res.ok) throw new Error('Failed to update conversation')
  return res.json()
}

export async function markContactRead(contactId: string): Promise<void> {
  await messagingClient.contacts[':id']['mark-read'].$post({
    param: { id: contactId },
  })
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useInboxMutations(contactId: string) {
  const queryClient = useQueryClient()

  const invalidateAll = useCallback(() => {
    invalidateConversationLists(queryClient, { contactId })
  }, [queryClient, contactId])

  const updateConversationMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateConversation>[1] }) =>
      updateConversation(id, body),
    onSuccess: invalidateAll,
  })

  const replyMutation = useMutation({
    mutationFn: ({
      conversationId,
      content,
      isInternal,
    }: {
      conversationId: string
      content: string
      isInternal: boolean
      replyToMessageId?: string
    }) => sendReply(conversationId, content, isInternal),
    onSuccess: invalidateAll,
  })

  const retryMutation = useMutation({
    mutationFn: ({ conversationId, messageId }: { conversationId: string; messageId: string }) =>
      messagingClient.conversations[':id'].messages[':mid'].retry.$post({
        param: { id: conversationId, mid: messageId },
      }),
    onSuccess: invalidateAll,
  })

  const newConversationMutation = useMutation({
    mutationFn: ({
      channelInstanceId,
      content,
      isInternal,
    }: {
      channelInstanceId: string
      content: string
      isInternal: boolean
    }) => createNewConversation(contactId, channelInstanceId, content, isInternal),
    onSuccess: invalidateAll,
  })

  return {
    replyMutation,
    updateConversationMutation,
    newConversationMutation,
    retryMutation,
    invalidateAll,
  }
}

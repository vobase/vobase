import { createFileRoute, redirect } from '@tanstack/react-router'

import { messagingClient } from '@/lib/api-client'

export const Route = createFileRoute('/_app/messaging/conversations/$conversationId')({
  beforeLoad: async ({ params }) => {
    const res = await messagingClient.conversations[':id'].$get({
      param: { id: params.conversationId },
    })
    if (!res.ok) {
      throw redirect({ to: '/messaging/inbox' })
    }
    const conversation = await res.json()
    throw redirect({
      to: '/messaging/inbox/$contactId',
      params: { contactId: conversation.contactId },
      search: { conversation: params.conversationId },
    })
  },
})

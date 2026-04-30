import { ConversationDetail } from '@modules/messaging/components/conversation-detail'
import { createFileRoute } from '@tanstack/react-router'

export { ConversationDetail as ConversationDetailPlaceholder } from '@modules/messaging/components/conversation-detail'

export const Route = createFileRoute('/_app/inbox/$contactId')({
  component: ConversationDetail,
})

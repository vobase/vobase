import { ConversationDetail } from '@modules/inbox/components/conversation-detail'
import { createFileRoute } from '@tanstack/react-router'

export { ConversationDetail as ConversationDetailPlaceholder } from '@modules/inbox/components/conversation-detail'

export const Route = createFileRoute('/_app/inbox/$contactId')({
  component: ConversationDetail,
})

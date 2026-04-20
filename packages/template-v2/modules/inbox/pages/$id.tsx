import { createFileRoute } from '@tanstack/react-router'
import { ConversationDetail } from '@modules/inbox/components/conversation-detail'

export { ConversationDetail as ConversationDetailPlaceholder } from '@modules/inbox/components/conversation-detail'

export const Route = createFileRoute('/_app/inbox/$id')({
  component: ConversationDetail,
})

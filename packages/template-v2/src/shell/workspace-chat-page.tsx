/**
 * Full-page operator chat route — `/workspace/chat/$threadId`. Reuses the
 * `<OperatorChat />` component so the right-rail and full-page surfaces share
 * one rendering path; only the layout chrome differs.
 *
 * Linked from the workspace tree (`/workspace/chats/<threadId>` opens a tab,
 * which currently embeds the chat inline; this route is the "pop out" target).
 */

import { createFileRoute } from '@tanstack/react-router'

import { useActiveOrganizationId } from '@/hooks/use-current-user'
import { OperatorChat } from './operator-chat'

export const Route = createFileRoute('/_app/workspace/chat/$threadId')({
  component: WorkspaceChatPage,
})

function WorkspaceChatPage() {
  const { threadId } = Route.useParams()
  const organizationId = useActiveOrganizationId()
  if (!organizationId) return null
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col p-4">
      <h1 className="mb-2 font-semibold text-base">Operator chat</h1>
      <div className="flex-1 overflow-hidden rounded-md border">
        <OperatorChat threadId={threadId} organizationId={organizationId} />
      </div>
    </div>
  )
}

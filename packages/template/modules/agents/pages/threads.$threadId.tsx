import { OperatorChat } from '@modules/agents/components/operator-chat'
import { createFileRoute } from '@tanstack/react-router'

import { useActiveOrganizationId } from '@/hooks/use-current-user'

export const Route = createFileRoute('/_app/agents/threads/$threadId')({
  component: AgentsThreadPage,
})

function AgentsThreadPage() {
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

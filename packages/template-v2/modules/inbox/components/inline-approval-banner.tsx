import { fetchApprovals, useDecideApproval } from '@modules/inbox/api/use-decide-approval'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'

interface InlineApprovalBannerProps {
  conversationId: string
}

export function InlineApprovalBanner({ conversationId }: InlineApprovalBannerProps) {
  const { data: allApprovals = [] } = useQuery({
    queryKey: ['approvals'],
    queryFn: fetchApprovals,
  })
  const pending = allApprovals.filter((a) => a.conversationId === conversationId && a.status === 'pending')
  const { mutate: decide, isPending } = useDecideApproval(conversationId)

  if (pending.length === 0) return null

  const approval = pending[0]
  if (!approval) return null

  return (
    <div className="mx-4 my-2 rounded-md bg-[var(--color-info)] px-4 py-3">
      <p className="mb-0.5 text-xs font-semibold text-[var(--color-info-fg)]">Pending approval</p>
      <p className="mb-2 font-mono text-xs text-[var(--color-info-fg)]">{approval.toolName}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => decide({ id: approval.id, conversationId, decision: 'approved' })}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => decide({ id: approval.id, conversationId, decision: 'rejected' })}
        >
          Reject
        </Button>
      </div>
    </div>
  )
}

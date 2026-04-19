import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Status } from '@/components/ui/status'
import { fetchApprovals, useDecideApproval } from './api/use-decide-approval'

interface PendingApprovalsPanelProps {
  conversationId: string
}

export function PendingApprovalsPanel({ conversationId }: PendingApprovalsPanelProps) {
  const { data: allApprovals = [] } = useQuery({
    queryKey: ['approvals'],
    queryFn: fetchApprovals,
  })
  const approvals = allApprovals.filter((a) => a.conversationId === conversationId)
  const { mutate: decide, isPending } = useDecideApproval(conversationId)

  function handleDecide(id: string, decision: 'approved' | 'rejected') {
    decide(
      { id, conversationId, decision },
      { onSuccess: () => toast.success(decision === 'approved' ? 'Approved' : 'Rejected') },
    )
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">Pending Approvals</p>
        <Status variant="awaiting_approval" label="" />
      </div>

      {approvals.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No pending approvals</EmptyTitle>
            <EmptyDescription>Approvals for this conversation will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {approvals.map((approval) => (
            <li key={approval.id} className="rounded-md border border-[var(--color-border-subtle)] p-3">
              <p className="mb-1 font-mono text-xs font-semibold text-[var(--color-fg)]">{approval.toolName}</p>
              <pre className="mb-2 max-h-20 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--color-surface)] p-1.5 text-xs text-[var(--color-fg-muted)]">
                {JSON.stringify(approval.toolArgs, null, 2)}
              </pre>
              <div className="flex gap-2">
                <Button size="sm" disabled={isPending} onClick={() => handleDecide(approval.id, 'approved')}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleDecide(approval.id, 'rejected')}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import type { PendingApproval } from '@server/contracts/domain-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApprovalRow } from '@/components/approval-row'

async function fetchPendingApprovals(): Promise<PendingApproval[]> {
  const res = await fetch('/api/inbox/approvals?status=pending')
  if (!res.ok) throw new Error('Failed to fetch approvals')
  return res.json() as Promise<PendingApproval[]>
}

export interface DecideParams {
  id: string
  decision: 'approved' | 'rejected'
  note?: string
}

async function decide(params: DecideParams): Promise<void> {
  const res = await fetch(`/api/inbox/approvals/${params.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision: params.decision,
      decidedByUserId: 'staff:current',
      note: params.note,
    }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string }
    throw new Error(err.error ?? 'Decision failed')
  }
}

export function ApprovalsPage() {
  const queryClient = useQueryClient()

  const {
    data: approvals = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['approvals'],
    queryFn: fetchPendingApprovals,
    refetchInterval: 30_000,
  })

  const handleDecide = async (params: DecideParams) => {
    await decide(params)
    await queryClient.invalidateQueries({ queryKey: ['approvals'] })
    await queryClient.invalidateQueries({ queryKey: ['conversations'] })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h1 className="text-sm font-semibold">Pending Approvals</h1>
        {approvals.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-info/15 px-2 py-0.5 text-mini font-medium text-info">
            {approvals.length} pending
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">Loading…</div>
        )}
        {error && (
          <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Failed to load approvals
          </div>
        )}
        {!isLoading && !error && approvals.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <span className="text-2xl">✓</span>
            <p className="text-sm text-muted-foreground">All clear — nothing pending</p>
          </div>
        )}
        <ul className="divide-y divide-border">
          {approvals.map((approval) => (
            <ApprovalRow key={approval.id} approval={approval} onDecide={handleDecide} />
          ))}
        </ul>
      </div>
    </div>
  )
}

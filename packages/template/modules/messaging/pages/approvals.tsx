import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ApprovalRow } from '@/components/approval-row'
import { messagingClient } from '@/lib/api-client'
import { hydratePendingApproval } from '@/lib/rpc-utils'
import type { PendingApproval } from '../schema'

async function fetchPendingApprovals(): Promise<PendingApproval[]> {
  const res = await messagingClient.approvals.$get({ query: { status: 'pending' } })
  if (!res.ok) throw new Error('Failed to fetch approvals')
  const rows = await res.json()
  return rows.map(hydratePendingApproval)
}

export interface DecideParams {
  id: string
  decision: 'approved' | 'rejected'
  note?: string
}

async function decide(params: DecideParams): Promise<void> {
  const res = await messagingClient.approvals[':id'].$post({
    param: { id: params.id },
    json: {
      decision: params.decision,
      decidedByUserId: 'staff:current',
      note: params.note,
    },
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
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-border border-b px-5 py-3">
        <h1 className="font-semibold text-sm">Pending Approvals</h1>
        {approvals.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-info/15 px-2 py-0.5 font-medium text-info text-mini">
            {approvals.length} pending
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-xs">Loading…</div>
        )}
        {error && (
          <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
            Failed to load approvals
          </div>
        )}
        {!isLoading && !error && approvals.length === 0 && (
          <div className="flex h-48 flex-col items-center justify-center gap-2">
            <span className="text-2xl">✓</span>
            <p className="text-muted-foreground text-sm">All clear — nothing pending</p>
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

export const Route = createFileRoute('/_app/inbox/approvals')({
  component: ApprovalsPage,
})

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ApprovalRow } from '@/components/approval-row'
import { ErrorBanner, PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
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
    <PageLayout>
      <PageHeader
        title={<span className="text-sm">Pending Approvals</span>}
        className="px-5 py-3"
        actions={
          approvals.length > 0 ? (
            <span className="inline-flex items-center rounded-full bg-info/15 px-2 py-0.5 font-medium text-info text-xs">
              {approvals.length} pending
            </span>
          ) : undefined
        }
      />
      <PageBody padded={false}>
        {isLoading && (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-xs">Loading…</div>
        )}
        {error && <ErrorBanner className="m-4">Failed to load approvals</ErrorBanner>}
        {!isLoading && !error && approvals.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <span className="text-2xl">✓</span>
              </EmptyMedia>
              <EmptyTitle>All clear</EmptyTitle>
              <EmptyDescription>Nothing pending</EmptyDescription>
            </EmptyHeader>
            <EmptyContent />
          </Empty>
        )}
        <ul className="divide-y divide-border">
          {approvals.map((approval) => (
            <ApprovalRow key={approval.id} approval={approval} onDecide={handleDecide} />
          ))}
        </ul>
      </PageBody>
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/inbox/approvals')({
  component: ApprovalsPage,
})

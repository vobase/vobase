import type { ChangeProposalRow } from '@modules/changes/schema'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ProposalRow } from '@/components/changes/proposal-row'
import { changesClient } from '@/lib/api-client'
import { hydrateChangeProposal } from '@/lib/rpc-utils'

export const Route = createFileRoute('/_app/changes')({
  component: ChangesPage,
})

async function fetchInbox(): Promise<ChangeProposalRow[]> {
  const res = await changesClient.inbox.$get()
  if (!res.ok) throw new Error('Failed to load change inbox')
  const body = await res.json()
  if (!Array.isArray(body)) throw new Error('Invalid inbox response')
  return body.map(hydrateChangeProposal)
}

function ChangesPage() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['change_proposals', 'pending'],
    queryFn: fetchInbox,
  })

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-semibold text-2xl">Pending changes</h1>
        <p className="text-muted-foreground text-sm">{data?.length ?? 0} pending</p>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {error && <p className="text-destructive text-sm">{error instanceof Error ? error.message : 'Failed'}</p>}

      {data && data.length === 0 && (
        <div className="rounded-md border border-border bg-muted/20 px-4 py-8 text-center text-muted-foreground text-sm">
          No pending proposals.
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {data.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              onDecided={() => qc.invalidateQueries({ queryKey: ['change_proposals'] })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

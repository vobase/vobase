import { LearningProposalRow } from '@/components/learning-proposal-row'
import { usePendingLearnings } from '@/hooks/use-pending-learnings'

export function LearningsPage() {
  const { data: proposals = [], isLoading, error, handleDecide } = usePendingLearnings()

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h1 className="text-sm font-semibold">Proposed Learnings</h1>
        {proposals.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600">
            {proposals.length} pending
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">Loading…</div>
        )}
        {error && (
          <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Failed to load proposals
          </div>
        )}
        {!isLoading && !error && proposals.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <span className="text-2xl">✓</span>
            <p className="text-sm text-muted-foreground">All clear — nothing pending</p>
          </div>
        )}
        <ul className="divide-y divide-border">
          {proposals.map((proposal) => (
            <LearningProposalRow
              key={proposal.id}
              proposal={proposal}
              onDecide={(id, decision, note) => handleDecide({ id, scope: proposal.scope, decision, note })}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}

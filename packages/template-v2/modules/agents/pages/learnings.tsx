import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Sparkles } from 'lucide-react'

import { LearningProposalRow } from '@/components/learning-proposal-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { usePendingLearnings } from '@/hooks/use-pending-learnings'

export function AgentsLearningsPage() {
  const { data: proposals = [], isLoading, error, handleDecide } = usePendingLearnings()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <Button asChild size="sm" variant="ghost">
          <Link to="/agents">
            <ArrowLeft className="mr-1 size-4" />
            Agents
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Proposed Learnings</h1>
          <p className="text-sm text-muted-foreground">
            High-blast-radius changes proposed by agents — staff review required.
          </p>
        </div>
        {proposals.length > 0 && <Badge variant="secondary">{proposals.length} pending</Badge>}
      </header>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading proposals…</div>
        )}
        {error && (
          <div className="m-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Failed to load proposals
          </div>
        )}
        {!isLoading && !error && proposals.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <Empty>
              <EmptyMedia>
                <Sparkles className="size-5" />
              </EmptyMedia>
              <EmptyTitle>All clear</EmptyTitle>
              <EmptyDescription>No pending proposals right now.</EmptyDescription>
            </Empty>
          </div>
        )}
        {!isLoading && !error && proposals.length > 0 && (
          <ul className="divide-y divide-border">
            {proposals.map((proposal) => (
              <LearningProposalRow
                key={proposal.id}
                proposal={proposal}
                onDecide={(id, decision, note) => handleDecide({ id, scope: proposal.scope, decision, note })}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/agents/learnings')({
  component: AgentsLearningsPage,
})

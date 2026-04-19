import type { LearningProposal } from '@server/contracts/domain-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export async function fetchPendingLearnings(): Promise<LearningProposal[]> {
  const res = await fetch('/api/agents/learnings')
  if (!res.ok) throw new Error('Failed to fetch pending learnings')
  return res.json() as Promise<LearningProposal[]>
}

export interface DecideLearningParams {
  id: string
  scope: LearningProposal['scope']
  decision: 'approved' | 'rejected'
  note?: string
}

export async function decideLearning(params: DecideLearningParams): Promise<void> {
  // agent_skill scope → POST /api/agents/skills/:id/decide
  // drive_doc scope → POST /api/drive/proposals/:id/decide (Phase 2 drive module)
  const url =
    params.scope === 'drive_doc' ? `/api/drive/proposals/${params.id}/decide` : `/api/agents/skills/${params.id}/decide`

  const res = await fetch(url, {
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

export function usePendingLearnings() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['learnings', 'pending'],
    queryFn: fetchPendingLearnings,
    refetchInterval: 30_000,
  })

  const handleDecide = async (params: DecideLearningParams) => {
    await decideLearning(params)
    await queryClient.invalidateQueries({ queryKey: ['learnings'] })
  }

  return { ...query, handleDecide }
}

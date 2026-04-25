import type { LearningProposal } from '@modules/agents/schema'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { agentsClient, driveClient } from '@/lib/api-client'
import { hydrateLearningProposal } from '@/lib/rpc-utils'

export async function fetchPendingLearnings(): Promise<LearningProposal[]> {
  const res = await agentsClient.learnings.$get()
  if (!res.ok) throw new Error('Failed to fetch pending learnings')
  const body = await res.json()
  if (!Array.isArray(body)) throw new Error('Failed to fetch pending learnings')
  return body.map(hydrateLearningProposal)
}

export interface DecideLearningParams {
  id: string
  scope: LearningProposal['scope']
  decision: 'approved' | 'rejected'
  note?: string
}

export async function decideLearning(params: DecideLearningParams): Promise<void> {
  const body = JSON.stringify({
    decision: params.decision,
    decidedByUserId: 'staff:current',
    note: params.note,
  })
  const init = { headers: { 'Content-Type': 'application/json' }, body }

  // agent_skill scope → POST /api/agents/skills/:id/decide
  // drive_doc scope  → POST /api/drive/proposals/:id/decide
  const res =
    params.scope === 'drive_doc'
      ? await driveClient.proposals[':id'].decide.$post({ param: { id: params.id } }, { init })
      : await agentsClient.skills[':id'].decide.$post({ param: { id: params.id } }, { init })

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

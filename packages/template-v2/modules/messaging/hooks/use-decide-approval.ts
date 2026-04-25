import { useMutation, useQueryClient } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'
import type { PendingApproval } from '../schema'

export async function fetchApprovals(): Promise<PendingApproval[]> {
  const r = await messagingClient.approvals.$get({ query: { status: 'pending' } })
  if (!r.ok) throw new Error('Failed to fetch approvals')
  return (await r.json()) as unknown as PendingApproval[]
}

interface DecideApprovalArgs {
  id: string
  conversationId: string
  decision: 'approved' | 'rejected'
  decidedByUserId?: string
}

export async function decideApproval({ id, decision, decidedByUserId = 'staff' }: DecideApprovalArgs) {
  const r = await messagingClient.approvals[':id'].$post({
    param: { id },
    json: { decision, decidedByUserId },
  })
  if (!r.ok) throw new Error('Failed to decide approval')
  return r.json()
}

export function useDecideApproval(conversationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: decideApproval,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
    },
  })
}

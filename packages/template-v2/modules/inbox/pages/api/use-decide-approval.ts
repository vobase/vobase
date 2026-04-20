import type { PendingApproval } from '@server/contracts/domain-types'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export async function fetchApprovals(): Promise<PendingApproval[]> {
  const r = await fetch('/api/inbox/approvals?status=pending')
  if (!r.ok) throw new Error('Failed to fetch approvals')
  return r.json()
}

interface DecideApprovalArgs {
  id: string
  conversationId: string
  decision: 'approved' | 'rejected'
  decidedByUserId?: string
}

export async function decideApproval({ id, decision, decidedByUserId = 'staff' }: DecideApprovalArgs) {
  const r = await fetch(`/api/inbox/approvals/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, decidedByUserId }),
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

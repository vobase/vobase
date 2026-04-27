import type { ChangeProposalRow } from '@modules/changes/schema'
import { useQuery } from '@tanstack/react-query'

import { changesClient } from '@/lib/api-client'
import { hydrateChangeProposal } from '@/lib/rpc-utils'

/** Shared key for the pending change-proposals inbox query. Single-sourced so
 *  rail badge, /changes page, and the conversation-scoped recent-changes panel
 *  all stay in lockstep with realtime NOTIFY invalidation. */
export const CHANGE_INBOX_QUERY_KEY = ['change_proposals', 'inbox'] as const

async function fetchInbox(): Promise<ChangeProposalRow[]> {
  const res = await changesClient.inbox.$get()
  if (!res.ok) throw new Error('Failed to load change inbox')
  const body = await res.json()
  return Array.isArray(body) ? body.map(hydrateChangeProposal) : []
}

export function useChangeProposalsInbox() {
  return useQuery({
    queryKey: CHANGE_INBOX_QUERY_KEY,
    queryFn: fetchInbox,
    refetchInterval: 30_000,
  })
}

export function usePendingChangesCount(): number {
  const { data } = useQuery({
    queryKey: CHANGE_INBOX_QUERY_KEY,
    queryFn: fetchInbox,
    refetchInterval: 30_000,
    select: (rows) => rows.length,
  })
  return data ?? 0
}

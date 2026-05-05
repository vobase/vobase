import type { ChangeStatus } from '@modules/changes/schema'
import type { ChangeProposalHistoryItem } from '@modules/changes/service/proposals'
import { useQuery } from '@tanstack/react-query'

import { changesClient } from '@/lib/api-client'
import { hydrateChangeProposalInbox } from '@/lib/rpc-utils'

/** Shared key for the decided change-proposals history query — paired with realtime
 *  NOTIFY invalidation via the `change_proposals` table mapping. */
export const CHANGE_HISTORY_QUERY_KEY = ['change_proposals', 'history'] as const

export interface UseChangeHistoryOptions {
  resourceModule?: string
  status?: ChangeStatus | 'all'
  limit?: number
}

async function fetchHistory(opts: UseChangeHistoryOptions): Promise<ChangeProposalHistoryItem[]> {
  const query: Record<string, string> = {}
  if (opts.resourceModule) query.resourceModule = opts.resourceModule
  if (opts.status) query.status = opts.status
  if (opts.limit) query.limit = String(opts.limit)
  const res = await changesClient.history.$get({ query })
  if (!res.ok) throw new Error('Failed to load change history')
  const body = await res.json()
  return Array.isArray(body) ? body.map((row) => hydrateChangeProposalInbox(row) as ChangeProposalHistoryItem) : []
}

export function useChangeHistory(opts: UseChangeHistoryOptions = {}) {
  return useQuery({
    queryKey: [...CHANGE_HISTORY_QUERY_KEY, opts.status ?? 'all', opts.resourceModule ?? '', opts.limit ?? 100] as const,
    queryFn: () => fetchHistory(opts),
    staleTime: 30_000,
  })
}

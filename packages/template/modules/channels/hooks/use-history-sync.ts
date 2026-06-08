import type { HistorySync } from '@modules/channels/components/history-sync-toast'
import { useQuery } from '@tanstack/react-query'

import { channelsClient } from '@/lib/api-client'

const HISTORY_SYNC_KEY = ['channels', 'history-sync'] as const

/**
 * Poll the org's WhatsApp coexistence history-import status. Refetches every 2s
 * while any instance is importing and every 12s otherwise, so a sync that
 * starts right after onboarding surfaces without a manual refresh. Pauses while
 * the tab is unfocused (TanStack default).
 */
export function useHistorySync() {
  return useQuery({
    queryKey: HISTORY_SYNC_KEY,
    refetchInterval: (query) => {
      const syncs = query.state.data?.syncs ?? []
      return syncs.some((s) => s.status === 'importing') ? 2000 : 12_000
    },
    queryFn: async (): Promise<{ syncs: HistorySync[] }> => {
      const res = await channelsClient.instances['history-sync'].$get()
      if (!res.ok) throw new Error(`history-sync fetch failed: ${res.status}`)
      return (await res.json()) as { syncs: HistorySync[] }
    },
  })
}

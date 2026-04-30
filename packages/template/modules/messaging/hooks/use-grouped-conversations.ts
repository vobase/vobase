/**
 * Single source of truth for the grouped-conversation list query.
 *
 * The list shell (`MessagingLayout`) and the conversation list pane both
 * fetched this independently — duplicate code with subtly different Date
 * handling and casts that defeated typed RPC. The hook centralizes:
 *   - typed RPC call against `messagingClient.conversations.$get({ grouped: '1' })`
 *   - `hydrateConversation` over the rows so the union from the handler
 *     resolves into the discriminated `{ rows, counts }` shape
 *   - shared `queryKey` so both consumers share cache + refetch
 */

import type { Conversation } from '@modules/messaging/schema'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'

import { messagingClient } from '@/lib/api-client'
import { hydrateConversation } from '@/lib/rpc-utils'

export interface GroupedConversations {
  rows: Conversation[]
  counts: { active: number; later: number; done: number }
}

export const groupedConversationsQueryKey = ['conversations', 'grouped'] as const

export async function fetchGroupedConversations(): Promise<GroupedConversations> {
  const r = await messagingClient.conversations.$get({ query: { grouped: '1' } })
  if (!r.ok) throw new Error('fetch failed')
  const body = await r.json()
  // The handler returns either `{ rows, counts }` (grouped) or `Conversation[]`
  // (flat); pinning `?grouped=1` guarantees the discriminated `rows` branch.
  if (!('rows' in body)) throw new Error('grouped response expected')
  return { rows: body.rows.map(hydrateConversation), counts: body.counts }
}

export function useGroupedConversations(): UseQueryResult<GroupedConversations> {
  return useQuery({ queryKey: groupedConversationsQueryKey, queryFn: fetchGroupedConversations })
}

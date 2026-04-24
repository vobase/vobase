import { useQueries } from '@tanstack/react-query'

import type { MessageScoreGroup } from '@/components/chat/message-quality'
import { agentsClient } from '@/lib/api-client'

interface ScoreRow {
  id: string
  scorerId: string
  score: number
  reason: string | null
  runId: string | null
  createdAt: string | null
  requestContext: {
    conversationId?: string
    messageIds?: string[]
  } | null
}

/** `Map<messageId, MessageScoreGroup>` — scores attached to the specific agent
 *  message they were produced against (the final reply of each wake). */
export type ConversationScoresByMessage = Map<string, MessageScoreGroup>

async function fetchConversationScores(conversationId: string): Promise<ScoreRow[]> {
  const res = await agentsClient.evals.conversation[':conversationId'].scores.$get({ param: { conversationId } })
  if (!res.ok) return []
  return res.json() as Promise<ScoreRow[]>
}

/**
 * Group score rows by the specific agent message each wake targeted.
 * Each row's `requestContext.messageIds` lists every agent reply the wake
 * produced; we attach the scores to the LAST one (the final reply). Later
 * wakes scoring the same message override earlier scores for that scorerId.
 */
function groupByMessage(rows: ScoreRow[]): ConversationScoresByMessage {
  // Ascending so later runs' scorers overwrite earlier ones.
  const sorted = [...rows].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))

  const byMessage = new Map<string, Map<string, { score: number; reason: string | null }>>()

  for (const row of sorted) {
    const messageIds = row.requestContext?.messageIds
    if (!messageIds || messageIds.length === 0) continue
    const targetId = messageIds[messageIds.length - 1]
    const scorerMap = byMessage.get(targetId) ?? new Map()
    scorerMap.set(row.scorerId, { score: row.score, reason: row.reason })
    byMessage.set(targetId, scorerMap)
  }

  const result: ConversationScoresByMessage = new Map()
  for (const [msgId, scorerMap] of byMessage) {
    result.set(msgId, {
      scores: [...scorerMap.entries()].map(([scorerId, { score, reason }]) => ({
        scorerId,
        score,
        reason,
      })),
    })
  }
  return result
}

/**
 * Fetches quality scores for a set of conversations, keyed per-message.
 * Returns `Map<conversationId, Map<messageId, MessageScoreGroup>>`.
 *
 * Scores are invalidated when `conversations-messages` SSE events fire,
 * with a 60s polling fallback for scores generated after async agent processing.
 */
export function useConversationScores(conversationIds: string[]): Map<string, ConversationScoresByMessage> {
  return useQueries({
    queries: conversationIds.map((id) => ({
      queryKey: ['conversation-scores', id] as const,
      queryFn: () => fetchConversationScores(id),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
    combine(results) {
      const map = new Map<string, ConversationScoresByMessage>()
      for (let i = 0; i < conversationIds.length; i++) {
        const data = results[i]?.data
        if (!data || data.length === 0) continue
        const grouped = groupByMessage(data)
        if (grouped.size > 0) map.set(conversationIds[i], grouped)
      }
      return map
    },
  })
}

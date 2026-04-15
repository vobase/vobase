import { useQueries } from '@tanstack/react-query';

import type { MessageScoreGroup } from '@/components/chat/message-quality';
import { agentsClient } from '@/lib/api-client';

interface ScoreRow {
  id: string;
  scorerId: string;
  score: number;
  reason: string | null;
  runId: string | null;
  createdAt: string | null;
}

async function fetchConversationScores(
  conversationId: string,
): Promise<ScoreRow[]> {
  const res = await agentsClient.evals.conversation[
    ':conversationId'
  ].scores.$get({ param: { conversationId } });
  if (!res.ok) return [];
  return res.json() as Promise<ScoreRow[]>;
}

/** Deduplicate scores: keep the latest per scorerId. */
function latestScores(rows: ScoreRow[]): MessageScoreGroup {
  const latest = new Map<string, ScoreRow>();
  for (const row of rows) {
    const existing = latest.get(row.scorerId);
    if (!existing || (row.createdAt ?? '') > (existing.createdAt ?? '')) {
      latest.set(row.scorerId, row);
    }
  }
  return {
    scores: [...latest.values()].map((r) => ({
      scorerId: r.scorerId,
      score: r.score,
      reason: r.reason,
    })),
  };
}

/**
 * Fetches quality scores for a set of conversations.
 * Returns a Map<conversationId, MessageScoreGroup> with the latest scores grouped by scorer.
 *
 * Scores are invalidated when `conversations-messages` SSE events fire,
 * with a 60s polling fallback for scores generated after async agent processing.
 */
export function useConversationScores(
  conversationIds: string[],
): Map<string, MessageScoreGroup> {
  return useQueries({
    queries: conversationIds.map((id) => ({
      queryKey: ['conversation-scores', id] as const,
      queryFn: () => fetchConversationScores(id),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
    combine(results) {
      const map = new Map<string, MessageScoreGroup>();
      for (let i = 0; i < conversationIds.length; i++) {
        const data = results[i]?.data;
        if (!data || data.length === 0) continue;
        map.set(conversationIds[i], latestScores(data));
      }
      return map;
    },
  });
}

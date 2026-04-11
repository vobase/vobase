import { useQuery } from '@tanstack/react-query';

import { agentsClient } from '@/lib/api-client';

interface QualityScore {
  avgScore: number;
  count: number;
}

async function fetchConversationScores(
  ids: string[],
): Promise<Record<string, QualityScore>> {
  if (ids.length === 0) return {};
  const res = await agentsClient.evals['conversation-scores'].$get({
    query: { conversationIds: ids.join(',') },
  });
  if (!res.ok) return {};
  return res.json();
}

/**
 * Batch-fetch quality scores for a list of conversation IDs.
 * Returns a Map for O(1) lookup per conversation.
 */
export function useConversationQuality(conversationIds: string[]) {
  const sorted = [...conversationIds].sort();
  const key = sorted.join(',');

  const { data } = useQuery({
    queryKey: ['conversation-quality', key],
    queryFn: () => fetchConversationScores(sorted),
    enabled: sorted.length > 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });

  return data ?? {};
}

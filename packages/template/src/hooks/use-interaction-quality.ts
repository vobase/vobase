import { useQuery } from '@tanstack/react-query';

import { aiClient } from '@/lib/api-client';

interface QualityScore {
  avgScore: number;
  count: number;
}

async function fetchInteractionScores(
  ids: string[],
): Promise<Record<string, QualityScore>> {
  if (ids.length === 0) return {};
  const res = await aiClient.evals['interaction-scores'].$get({
    query: { interactionIds: ids.join(',') },
  });
  if (!res.ok) return {};
  return res.json();
}

/**
 * Batch-fetch quality scores for a list of interaction IDs.
 * Returns a Map for O(1) lookup per interaction.
 */
export function useInteractionQuality(interactionIds: string[]) {
  const sorted = [...interactionIds].sort();
  const key = sorted.join(',');

  const { data } = useQuery({
    queryKey: ['interaction-quality', key],
    queryFn: () => fetchInteractionScores(sorted),
    enabled: sorted.length > 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });

  return data ?? {};
}

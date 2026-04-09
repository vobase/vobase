/**
 * Reciprocal Rank Fusion (RRF) scoring utility.
 * Shared by knowledge-base hybrid search and interaction memory retrieval.
 *
 * RRF merges multiple ranked lists into a single score:
 *   score(doc) = Σ 1/(k + rank_i)
 */

const DEFAULT_RRF_K = 60;

/**
 * Build a rank map from an ordered list of IDs.
 * Rank is 1-based (first item = rank 1).
 */
export function buildRankMap(ids: string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    ranks.set(ids[i], i + 1);
  }
  return ranks;
}

/**
 * Compute RRF scores from multiple rank lists.
 * Returns scored items sorted by descending score.
 */
export function computeRRFScores(
  rankLists: Map<string, number>[],
  k: number = DEFAULT_RRF_K,
): Array<{ id: string; score: number }> {
  const allIds = new Set<string>();
  for (const ranks of rankLists) {
    for (const id of ranks.keys()) allIds.add(id);
  }

  const scores: Array<{ id: string; score: number }> = [];
  for (const id of allIds) {
    let score = 0;
    for (const ranks of rankLists) {
      const rank = ranks.get(id);
      if (rank !== undefined) {
        score += 1 / (k + rank);
      }
    }
    scores.push({ id, score });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

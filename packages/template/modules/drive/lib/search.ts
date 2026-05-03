/**
 * Hybrid pgvector + tsvector search scorer.
 *
 * Service-side helper: takes a query string + a candidate-row set with both a
 * cosine distance and a `ts_rank` and produces the canonical hybrid score.
 *
 * `score = 0.7 * (1 - cosineDistance) + 0.3 * tsRank`
 *
 * The actual SQL lives in `service/files.ts` (this module ships the pure
 * scorer + sort helper so unit tests can exercise scoring without spinning up
 * Postgres).
 */

const VECTOR_WEIGHT = 0.7
const KEYWORD_WEIGHT = 0.3

export interface ScoreInput {
  cosineDistance: number
  tsRank: number
}

/** Compute the hybrid score for a single candidate. */
export function hybridScore({ cosineDistance, tsRank }: ScoreInput): number {
  const vec = 1 - cosineDistance
  return VECTOR_WEIGHT * vec + KEYWORD_WEIGHT * tsRank
}

export interface RankedCandidate<T> {
  row: T
  cosineDistance: number
  tsRank: number
  score: number
}

/** Rank an array of `{ row, cosineDistance, tsRank }` candidates by hybrid score, descending. */
export function rankCandidates<T>(
  items: Array<{ row: T; cosineDistance: number; tsRank: number }>,
): RankedCandidate<T>[] {
  return items.map((item) => ({ ...item, score: hybridScore(item) })).sort((a, b) => b.score - a.score)
}

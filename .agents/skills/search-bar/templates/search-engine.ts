/**
 * Generic vector + FTS search utilities.
 * No domain knowledge — all domain config is passed in by the caller.
 *
 * Part of the vobase search skill.
 */

import { embedText, warmupEmbedModel } from './local-embed';

export { warmupEmbedModel };

// ── Embedding cache ───────────────────────────────────────────────────────────

interface EmbeddingRow { agent_id: string; embedding: string }

let _embeddingCache: Map<string, Float32Array> | null = null;

// Query embedding LRU cache (keyed by query string, TTL 10 min)
const _queryEmbeddingCache = new Map<string, { vec: Float32Array; ts: number }>();
const QUERY_CACHE_TTL = 10 * 60 * 1000;

/**
 * Load all pre-computed embeddings from the DB into a Map.
 * Cached in memory — call invalidateEmbeddingCache() after any write.
 */
export function getEmbeddingCache(
  rawDb: any,
  tableName = 'agent_embeddings',
): Map<string, Float32Array> {
  if (_embeddingCache) return _embeddingCache;
  const rows = rawDb.prepare(
    `SELECT agent_id, embedding FROM ${tableName}`,
  ).all() as EmbeddingRow[];
  _embeddingCache = new Map();
  for (const row of rows) {
    try {
      _embeddingCache.set(row.agent_id, new Float32Array(JSON.parse(row.embedding)));
    } catch { /* skip malformed row */ }
  }
  return _embeddingCache;
}

/** Drop the in-memory embedding cache so the next call to getEmbeddingCache re-reads the DB. */
export function invalidateEmbeddingCache(): void {
  _embeddingCache = null;
}

// ── Vector math ───────────────────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Embed a query string with a short-lived LRU cache to avoid re-embedding identical queries. */
export async function embedQuery(query: string): Promise<Float32Array | null> {
  const cached = _queryEmbeddingCache.get(query);
  if (cached && Date.now() - cached.ts < QUERY_CACHE_TTL) return cached.vec;
  try {
    const vec = await embedText(query);
    if (!vec) return null;
    _queryEmbeddingCache.set(query, { vec, ts: Date.now() });
    // Evict oldest entry when cache grows large
    if (_queryEmbeddingCache.size > 500) {
      const oldest = _queryEmbeddingCache.keys().next().value;
      if (oldest) _queryEmbeddingCache.delete(oldest);
    }
    return vec;
  } catch {
    return null;
  }
}

/**
 * Return the top-K agents by cosine similarity to the query vector.
 * Only returns agents with similarity >= minSimilarity.
 */
export function vectorSearch(
  queryVec: Float32Array,
  cache: Map<string, Float32Array>,
  topK = 150,
  minSimilarity = 0.35,
): { agentId: string; similarity: number }[] {
  const scored: { agentId: string; similarity: number }[] = [];
  for (const [agentId, vec] of cache) {
    const sim = cosineSimilarity(queryVec, vec);
    if (sim >= minSimilarity) scored.push({ agentId, similarity: sim });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

// ── NLP utilities ─────────────────────────────────────────────────────────────

/**
 * Tokenize a query string, removing short tokens and the caller-supplied stopwords.
 * Returns lowercase tokens only.
 */
export function tokenize(q: string, stopwords: Set<string>): string[] {
  return q.toLowerCase().split(/\s+/).filter((k) => k.length > 0 && !stopwords.has(k));
}

/**
 * Extract structured intent signals from a raw query string.
 * Detects price budget (e.g. "under $500") and implied sort direction.
 * Returns the cleaned query with those fragments removed.
 */
export function extractIntent(
  raw: string,
): { cleanQuery: string; impliedBudget?: number; impliedSort?: string } {
  let q = raw.toLowerCase();
  let impliedBudget: number | undefined;
  let impliedSort: string | undefined;

  const budgetMatch = q.match(/(?:under|below|less\s+than)?\s*\$?(\d+(?:\.\d+)?)/);
  if (
    budgetMatch &&
    (q.includes('under') || q.includes('below') || q.includes('less than') || q.includes('$'))
  ) {
    impliedBudget = parseFloat(budgetMatch[1]);
    q = q.replace(budgetMatch[0], '').trim();
  }

  if (/best\s+rated|top\s+rated|highest\s+rated/.test(q)) impliedSort = 'rating';
  if (/fastest|quick\s+delivery|fast\s+delivery/.test(q)) impliedSort = 'delivery';
  if (/cheap|affordable|lowest\s+price|budget/.test(q)) impliedSort = 'price_asc';

  return { cleanQuery: q, impliedBudget, impliedSort };
}

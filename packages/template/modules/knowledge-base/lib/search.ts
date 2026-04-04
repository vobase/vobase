import type { VobaseDb } from '@vobase/core';
import { eq, sql } from 'drizzle-orm';
import { cosineDistance } from 'drizzle-orm/sql/functions/vector';

import { isAIConfigured } from '../../../lib/ai';
import { buildRankMap, computeRRFScores } from '../../../lib/search-utils';
import { kbChunks, kbDocuments } from '../schema';
import { embedQuery } from './embeddings';

interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  chunkIndex: number;
}

interface SearchOptions {
  limit?: number;
  /** @deprecated Ignored — RRF is now used for score fusion. Kept for backward compatibility. */
  vectorWeight?: number;
  /** @deprecated Ignored — RRF is now used for score fusion. Kept for backward compatibility. */
  keywordWeight?: number;
  sourceIds?: string[];
  sortHint?: string;
  /** Search mode: 'fast' (RRF only, default) or 'deep' (RRF + HyDE + optional re-ranking). */
  mode?: 'fast' | 'deep';
  /** Enable LLM re-ranking of top results (only in 'deep' mode). */
  rerank?: boolean;
}

/**
 * Hybrid search using Reciprocal Rank Fusion (RRF).
 *
 * Fast mode (default): RRF merges pgvector cosine similarity + tsvector keyword results.
 * Deep mode: adds HyDE (hypothetical document embedding) + optional LLM re-ranking.
 */
export async function hybridSearch(
  db: VobaseDb,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const limit = options?.limit ?? 10;
  const mode = options?.mode ?? 'fast';
  const fetchCount = limit * 3;

  // 1. Embed the original query
  const queryEmbedding = await embedQuery(query);

  // 2. Vector search using pgvector cosine distance
  const vectorResults = await db
    .select({
      id: kbChunks.id,
      distance: cosineDistance(kbChunks.embedding, queryEmbedding),
    })
    .from(kbChunks)
    .orderBy(cosineDistance(kbChunks.embedding, queryEmbedding))
    .limit(fetchCount);

  // 3. Full-text search using tsvector + ts_rank
  let keywordResults: Array<{ id: string; rank: number }> = [];
  if (query.trim()) {
    try {
      keywordResults = await db
        .select({
          id: kbChunks.id,
          rank: sql<number>`ts_rank(${kbChunks.searchVector}, websearch_to_tsquery('english', ${query}))`,
        })
        .from(kbChunks)
        .where(
          sql`${kbChunks.searchVector} @@ websearch_to_tsquery('english', ${query})`,
        )
        .orderBy(
          sql`ts_rank(${kbChunks.searchVector}, websearch_to_tsquery('english', ${query})) DESC`,
        )
        .limit(fetchCount);
    } catch {
      // FTS query syntax errors are non-fatal
    }
  }

  // 4. Build rank lists for RRF
  const rankLists: Map<string, number>[] = [];
  rankLists.push(buildRankMap(vectorResults.map((r) => r.id)));
  rankLists.push(buildRankMap(keywordResults.map((r) => r.id)));

  // 5. Deep mode: HyDE query expansion
  if (mode === 'deep') {
    try {
      const hydeEmbedding = await generateHyDE(query);
      if (hydeEmbedding) {
        const hydeResults = await db
          .select({
            id: kbChunks.id,
            distance: cosineDistance(kbChunks.embedding, hydeEmbedding),
          })
          .from(kbChunks)
          .orderBy(cosineDistance(kbChunks.embedding, hydeEmbedding))
          .limit(fetchCount);

        rankLists.push(buildRankMap(hydeResults.map((r) => r.id)));
      }
    } catch {
      // HyDE failure is non-fatal — graceful degradation to fast mode
    }
  }

  // 6. Compute RRF scores
  const rrfScores = computeRRFScores(rankLists);

  // 7. Fetch chunk data
  const candidateLimit = mode === 'deep' && options?.rerank ? limit * 2 : limit;
  const topCandidates = rrfScores.slice(0, candidateLimit);

  const results: SearchResult[] = [];
  for (const { id, score } of topCandidates) {
    const chunk = (
      await db.select().from(kbChunks).where(eq(kbChunks.id, id))
    )[0];
    if (!chunk) continue;

    const doc = (
      await db
        .select({ title: kbDocuments.title, id: kbDocuments.id })
        .from(kbDocuments)
        .where(eq(kbDocuments.id, chunk.documentId))
    )[0];

    results.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: doc?.title ?? 'Unknown',
      content: chunk.content,
      score,
      chunkIndex: chunk.chunkIndex,
    });
  }

  // 8. Deep mode: optional LLM re-ranking
  if (mode === 'deep' && options?.rerank && results.length > limit) {
    try {
      const reranked = await rerankWithLLM(query, results, limit);
      return reranked;
    } catch {
      // Re-ranking failure is non-fatal — return RRF-only results
    }
  }

  return results.slice(0, limit);
}

// --- HyDE: Hypothetical Document Embedding ---

async function generateHyDE(query: string): Promise<number[] | null> {
  if (!isAIConfigured()) return null;

  const { generateText } = await import('ai');
  const { openai } = await import('@ai-sdk/openai');

  const { text: hypothetical } = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: `Write a short passage (2-3 sentences) that directly answers this question. Do not include any preamble or meta-commentary, just the answer:\n\n${query}`,
    maxOutputTokens: 200,
  });

  return embedQuery(hypothetical);
}

// --- LLM Re-ranking ---

async function rerankWithLLM(
  query: string,
  candidates: SearchResult[],
  topK: number,
): Promise<SearchResult[]> {
  const { generateText } = await import('ai');
  const { openai } = await import('@ai-sdk/openai');

  const passages = candidates
    .map((c, i) => `[${i}] ${c.content.slice(0, 300)}`)
    .join('\n\n');

  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: `Given the query: "${query}"\n\nRank these passages by relevance. Return ONLY a JSON array of passage indices (numbers) in order of most relevant to least relevant. Example: [3, 0, 5, 1]\n\n${passages}`,
    maxOutputTokens: 200,
  });

  const match = text.match(/\[[\d\s,]+\]/);
  if (!match) return candidates.slice(0, topK);

  const indices: number[] = JSON.parse(match[0]);
  const reranked: SearchResult[] = [];

  for (const idx of indices) {
    if (idx >= 0 && idx < candidates.length && reranked.length < topK) {
      reranked.push({ ...candidates[idx], score: 1 - reranked.length / topK });
    }
  }

  for (const candidate of candidates) {
    if (reranked.length >= topK) break;
    if (!reranked.some((r) => r.chunkId === candidate.chunkId)) {
      reranked.push(candidate);
    }
  }

  return reranked;
}

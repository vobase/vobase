import { eq } from 'drizzle-orm';

import type { VobaseDb } from '@vobase/core';

import { kbChunks, kbDocuments } from '../schema';
import { tokenize } from '../search-config';
import { embedQuery } from './embeddings';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  chunkIndex: number;
}

export interface SearchOptions {
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

const RRF_K = 60; // Standard RRF constant

/**
 * Hybrid search using Reciprocal Rank Fusion (RRF).
 *
 * Fast mode (default): RRF merges vector similarity + FTS5 keyword results.
 * Deep mode: adds HyDE (hypothetical document embedding) + optional LLM re-ranking.
 */
export async function hybridSearch(db: VobaseDb, query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const limit = options?.limit ?? 10;
  const mode = options?.mode ?? 'fast';
  const raw = db.$client;

  // 1. Embed the original query
  const queryEmbedding = await embedQuery(query);
  const embeddingJson = JSON.stringify(queryEmbedding);
  const fetchCount = limit * 3; // Fetch more candidates for RRF merging

  // 2. Vector search with original embedding
  const vectorResults = raw
    .prepare('SELECT rowid, distance FROM kb_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?')
    .all(embeddingJson, fetchCount) as Array<{ rowid: number; distance: number }>;

  // 3. FTS5 keyword search
  const keywords = tokenize(query);
  const ftsQuery = keywords.join(' ');
  let keywordResults: Array<{ rowid: number; rank: number }> = [];
  if (ftsQuery) {
    try {
      keywordResults = raw
        .prepare('SELECT rowid, rank FROM kb_chunks_fts WHERE kb_chunks_fts MATCH ? ORDER BY rank LIMIT ?')
        .all(ftsQuery, fetchCount) as Array<{ rowid: number; rank: number }>;
    } catch {
      // FTS5 query syntax errors are non-fatal
    }
  }

  // 4. Build rank lists for RRF
  const rankLists: Map<number, number>[] = [];

  // Vector ranks (rank 1 = closest)
  const vectorRanks = new Map<number, number>();
  vectorResults.forEach((r, i) => vectorRanks.set(r.rowid, i + 1));
  rankLists.push(vectorRanks);

  // Keyword ranks (rank 1 = best FTS5 match)
  const keywordRanks = new Map<number, number>();
  keywordResults.forEach((r, i) => keywordRanks.set(r.rowid, i + 1));
  rankLists.push(keywordRanks);

  // 5. Deep mode: HyDE query expansion
  if (mode === 'deep') {
    try {
      const hydeEmbedding = await generateHyDE(query);
      if (hydeEmbedding) {
        const hydeJson = JSON.stringify(hydeEmbedding);
        const hydeResults = raw
          .prepare('SELECT rowid, distance FROM kb_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?')
          .all(hydeJson, fetchCount) as Array<{ rowid: number; distance: number }>;

        const hydeRanks = new Map<number, number>();
        hydeResults.forEach((r, i) => hydeRanks.set(r.rowid, i + 1));
        rankLists.push(hydeRanks);
      }
    } catch {
      // HyDE failure is non-fatal — graceful degradation to fast mode
    }
  }

  // 6. Compute RRF scores
  const allRowIds = new Set<number>();
  for (const ranks of rankLists) {
    for (const rowId of ranks.keys()) allRowIds.add(rowId);
  }

  const rrfScores: Array<{ rowId: number; score: number }> = [];
  for (const rowId of allRowIds) {
    let score = 0;
    for (const ranks of rankLists) {
      const rank = ranks.get(rowId);
      if (rank !== undefined) {
        score += 1 / (RRF_K + rank);
      }
    }
    rrfScores.push({ rowId, score });
  }

  rrfScores.sort((a, b) => b.score - a.score);

  // 7. Fetch chunk data
  const candidateLimit = mode === 'deep' && options?.rerank ? limit * 2 : limit;
  const topCandidates = rrfScores.slice(0, candidateLimit);

  const results: SearchResult[] = [];
  for (const { rowId, score } of topCandidates) {
    const chunk = await db.select().from(kbChunks).where(eq(kbChunks.rowId, rowId)).get();
    if (!chunk) continue;

    const doc = await db
      .select({ title: kbDocuments.title, id: kbDocuments.id })
      .from(kbDocuments)
      .where(eq(kbDocuments.id, chunk.documentId))
      .get();

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
  const { isAIConfigured } = await import('../../../lib/ai');
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

async function rerankWithLLM(query: string, candidates: SearchResult[], topK: number): Promise<SearchResult[]> {
  const { generateText } = await import('ai');
  const { openai } = await import('@ai-sdk/openai');

  const passages = candidates.map((c, i) => `[${i}] ${c.content.slice(0, 300)}`).join('\n\n');

  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: `Given the query: "${query}"\n\nRank these passages by relevance. Return ONLY a JSON array of passage indices (numbers) in order of most relevant to least relevant. Example: [3, 0, 5, 1]\n\n${passages}`,
    maxOutputTokens: 200,
  });

  // Parse the JSON array of indices
  const match = text.match(/\[[\d\s,]+\]/);
  if (!match) return candidates.slice(0, topK);

  const indices: number[] = JSON.parse(match[0]);
  const reranked: SearchResult[] = [];

  for (const idx of indices) {
    if (idx >= 0 && idx < candidates.length && reranked.length < topK) {
      reranked.push({ ...candidates[idx], score: 1 - reranked.length / topK }); // Normalize scores
    }
  }

  // Fill remaining slots if LLM didn't return enough indices
  for (const candidate of candidates) {
    if (reranked.length >= topK) break;
    if (!reranked.some((r) => r.chunkId === candidate.chunkId)) {
      reranked.push(candidate);
    }
  }

  return reranked;
}

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
  vectorWeight?: number; // Default: 0.7
  keywordWeight?: number; // Default: 0.3
  sourceIds?: string[]; // Filter by KB source IDs
  sortHint?: string; // e.g. 'recent', 'oldest' — from intent extraction
}

/**
 * Hybrid search: combines sqlite-vec vector similarity with FTS5 keyword matching.
 * Merges scores with configurable weights (default 0.7 vector + 0.3 keyword).
 */
export async function hybridSearch(db: VobaseDb, query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const limit = options?.limit ?? 10;
  const vectorWeight = options?.vectorWeight ?? 0.7;
  const keywordWeight = options?.keywordWeight ?? 0.3;
  const raw = db.$client;

  // 1. Vector search via sqlite-vec KNN
  const queryEmbedding = await embedQuery(query);
  const embeddingJson = JSON.stringify(queryEmbedding);

  const vectorResults = raw
    .prepare(
      `
    SELECT rowid, distance
    FROM kb_embeddings
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `,
    )
    .all(embeddingJson, limit * 2) as Array<{ rowid: number; distance: number }>;

  // 2. Keyword search via FTS5
  // Tokenize with stopword removal, then join for FTS5 query
  const keywords = tokenize(query);
  const ftsQuery = keywords.join(' ');
  let keywordResults: Array<{ rowid: number; rank: number }> = [];
  if (ftsQuery) {
    try {
      keywordResults = raw
        .prepare(
          `
        SELECT rowid, rank
        FROM kb_chunks_fts
        WHERE kb_chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `,
        )
        .all(ftsQuery, limit * 2) as Array<{ rowid: number; rank: number }>;
    } catch {
      // FTS5 query syntax errors are non-fatal
    }
  }

  // 3. Merge scores
  const scoreMap = new Map<number, { vectorScore: number; keywordScore: number }>();

  // Normalize vector distances to 0-1 similarity scores
  const maxDistance =
    vectorResults.length > 0 ? Math.max(...vectorResults.map((r) => r.distance), 1) : 1;

  for (const r of vectorResults) {
    const similarity = 1 - r.distance / maxDistance;
    scoreMap.set(r.rowid, { vectorScore: similarity, keywordScore: 0 });
  }

  // Normalize FTS5 ranks (rank is negative, closer to 0 = better match)
  const minRank =
    keywordResults.length > 0 ? Math.min(...keywordResults.map((r) => r.rank), -1) : -1;

  for (const r of keywordResults) {
    const normalized = 1 - r.rank / minRank;
    const existing = scoreMap.get(r.rowid);
    if (existing) {
      existing.keywordScore = normalized;
    } else {
      scoreMap.set(r.rowid, { vectorScore: 0, keywordScore: normalized });
    }
  }

  // 4. Compute combined scores and rank
  const rankedRowIds = [...scoreMap.entries()]
    .map(([rowId, scores]) => ({
      rowId,
      score: scores.vectorScore * vectorWeight + scores.keywordScore * keywordWeight,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (rankedRowIds.length === 0) return [];

  // 5. Fetch chunk data from Drizzle
  const results: SearchResult[] = [];
  for (const { rowId, score } of rankedRowIds) {
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

  return results;
}

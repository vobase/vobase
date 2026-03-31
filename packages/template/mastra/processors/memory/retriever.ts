import type { VobaseDb } from '@vobase/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { cosineDistance } from 'drizzle-orm/sql/functions/vector';

import { embedQuery } from '../../../lib/embeddings';
import { buildRankMap, computeRRFScores } from '../../../lib/search-utils';
import {
  aiMemCells,
  aiMemEpisodes,
  aiMemEventLogs,
} from '../../../modules/ai/schema';
import type { MemoryRetrievalResult, MemoryScope } from './types';

interface RetrieveOptions {
  limit?: number;
}

/** Build a scope WHERE condition — always scoped by contactId. */
function episodeScopeCond(scope: MemoryScope) {
  return eq(aiMemEpisodes.contactId, scope.contactId);
}

function factScopeCond(scope: MemoryScope) {
  return eq(aiMemEventLogs.contactId, scope.contactId);
}

function cellScopeCond(scope: MemoryScope) {
  return eq(aiMemCells.contactId, scope.contactId);
}

/**
 * Retrieve relevant memory (episodes + facts) for a query, scoped by contact or user.
 * Uses flat hybrid search (BM25 + vector) with RRF fusion.
 */
export async function retrieveMemory(
  db: VobaseDb,
  scope: MemoryScope,
  query: string,
  options?: RetrieveOptions,
): Promise<MemoryRetrievalResult> {
  const limit = options?.limit ?? 5;
  const fetchCount = limit * 3;

  // Embed the query
  const queryEmbedding = await embedQuery(query);

  // Search episodes and event_logs in parallel
  const [episodeResults, factResults] = await Promise.all([
    searchEpisodes(db, scope, query, queryEmbedding, fetchCount),
    searchFacts(db, scope, query, queryEmbedding, fetchCount),
  ]);

  // RRF merge episodes
  const episodeRankLists: Map<string, number>[] = [];
  if (episodeResults.vector.length > 0) {
    episodeRankLists.push(buildRankMap(episodeResults.vector.map((r) => r.id)));
  }
  if (episodeResults.keyword.length > 0) {
    episodeRankLists.push(
      buildRankMap(episodeResults.keyword.map((r) => r.id)),
    );
  }
  const episodeScores =
    episodeRankLists.length > 0 ? computeRRFScores(episodeRankLists) : [];

  // RRF merge facts
  const factRankLists: Map<string, number>[] = [];
  if (factResults.vector.length > 0) {
    factRankLists.push(buildRankMap(factResults.vector.map((r) => r.id)));
  }
  if (factResults.keyword.length > 0) {
    factRankLists.push(buildRankMap(factResults.keyword.map((r) => r.id)));
  }
  const factScores =
    factRankLists.length > 0 ? computeRRFScores(factRankLists) : [];

  // Build episode lookup map
  const allEpisodes = new Map<string, (typeof episodeResults.vector)[number]>();
  for (const e of [...episodeResults.vector, ...episodeResults.keyword]) {
    allEpisodes.set(e.id, e);
  }

  // Build fact lookup map
  const allFacts = new Map<string, (typeof factResults.vector)[number]>();
  for (const f of [...factResults.vector, ...factResults.keyword]) {
    allFacts.set(f.id, f);
  }

  // Assemble top episodes
  const topEpisodes = episodeScores.slice(0, limit).flatMap(({ id, score }) => {
    const ep = allEpisodes.get(id);
    if (!ep) return [];
    return [
      {
        id: ep.id,
        cellId: ep.cellId,
        title: ep.title,
        content: ep.content,
        score,
      },
    ];
  });

  // Assemble top facts
  const topFacts = factScores.slice(0, limit).flatMap(({ id, score }) => {
    const f = allFacts.get(id);
    if (!f) return [];
    return [
      {
        id: f.id,
        cellId: f.cellId,
        fact: f.fact,
        subject: f.subject,
        score,
      },
    ];
  });

  // Original text injection: fetch source messages for top episode cells
  const originalMessages = await fetchOriginalMessages(
    db,
    topEpisodes.map((e) => e.cellId),
    scope,
  );

  return {
    episodes: topEpisodes,
    facts: topFacts,
    originalMessages,
  };
}

// --- Internal search helpers ---

async function searchEpisodes(
  db: VobaseDb,
  scope: MemoryScope,
  query: string,
  queryEmbedding: number[],
  fetchCount: number,
) {
  const scopeCond = episodeScopeCond(scope);

  // Vector search
  const vector = await db
    .select({
      id: aiMemEpisodes.id,
      cellId: aiMemEpisodes.cellId,
      title: aiMemEpisodes.title,
      content: aiMemEpisodes.content,
      distance: cosineDistance(aiMemEpisodes.embedding, queryEmbedding),
    })
    .from(aiMemEpisodes)
    .where(scopeCond)
    .orderBy(cosineDistance(aiMemEpisodes.embedding, queryEmbedding))
    .limit(fetchCount);

  // Keyword search
  let keyword: typeof vector = [];
  if (query.trim()) {
    try {
      keyword = await db
        .select({
          id: aiMemEpisodes.id,
          cellId: aiMemEpisodes.cellId,
          title: aiMemEpisodes.title,
          content: aiMemEpisodes.content,
          distance: sql<number>`0`,
        })
        .from(aiMemEpisodes)
        .where(
          and(
            scopeCond,
            sql`${aiMemEpisodes.searchVector} @@ websearch_to_tsquery('english', ${query})`,
          ),
        )
        .orderBy(
          sql`ts_rank(${aiMemEpisodes.searchVector}, websearch_to_tsquery('english', ${query})) DESC`,
        )
        .limit(fetchCount);
    } catch {
      // FTS query syntax errors are non-fatal
    }
  }

  return { vector, keyword };
}

async function searchFacts(
  db: VobaseDb,
  scope: MemoryScope,
  query: string,
  queryEmbedding: number[],
  fetchCount: number,
) {
  const scopeCond = factScopeCond(scope);

  // Vector search
  const vector = await db
    .select({
      id: aiMemEventLogs.id,
      cellId: aiMemEventLogs.cellId,
      fact: aiMemEventLogs.fact,
      subject: aiMemEventLogs.subject,
      distance: cosineDistance(aiMemEventLogs.embedding, queryEmbedding),
    })
    .from(aiMemEventLogs)
    .where(scopeCond)
    .orderBy(cosineDistance(aiMemEventLogs.embedding, queryEmbedding))
    .limit(fetchCount);

  // Keyword search
  let keyword: typeof vector = [];
  if (query.trim()) {
    try {
      keyword = await db
        .select({
          id: aiMemEventLogs.id,
          cellId: aiMemEventLogs.cellId,
          fact: aiMemEventLogs.fact,
          subject: aiMemEventLogs.subject,
          distance: sql<number>`0`,
        })
        .from(aiMemEventLogs)
        .where(
          and(
            scopeCond,
            sql`${aiMemEventLogs.searchVector} @@ websearch_to_tsquery('english', ${query})`,
          ),
        )
        .orderBy(
          sql`ts_rank(${aiMemEventLogs.searchVector}, websearch_to_tsquery('english', ${query})) DESC`,
        )
        .limit(fetchCount);
    } catch {
      // FTS query syntax errors are non-fatal
    }
  }

  return { vector, keyword };
}

/**
 * Fetch original messages from MemCells for context injection.
 * Batches all cells into a single query to avoid N+1.
 * Gracefully degrades when source messages have been purged.
 */
async function fetchOriginalMessages(
  db: VobaseDb,
  cellIds: string[],
  scope: MemoryScope,
): Promise<MemoryRetrievalResult['originalMessages']> {
  if (cellIds.length === 0) return [];

  // Deduplicate cell IDs
  const uniqueCellIds = [...new Set(cellIds)];

  // Scope filter — enforce access control on cell lookup.
  // Design: contact-scoped cells store contactId only (not userId) because
  // contactId is the primary retrieval key for channel conversations.
  const scopeCond = cellScopeCond(scope);

  // Load cells to get message ranges (scoped)
  const cells = await db
    .select({
      id: aiMemCells.id,
      threadId: aiMemCells.threadId,
      startMessageId: aiMemCells.startMessageId,
      endMessageId: aiMemCells.endMessageId,
    })
    .from(aiMemCells)
    .where(and(inArray(aiMemCells.id, uniqueCellIds), scopeCond));

  if (cells.length === 0) return [];

  // Load messages from Mastra Memory for each cell's range
  const { loadMessagesInRange } = await import('./message-source');
  const allMessages: { content: string; role: string; createdAt: Date }[] = [];

  for (const cell of cells) {
    const msgs = await loadMessagesInRange(
      db,
      cell.threadId,
      cell.startMessageId,
      cell.endMessageId,
    );
    for (const m of msgs) {
      allMessages.push({
        content: m.content ?? '',
        role: m.aiRole ?? 'user',
        createdAt: m.createdAt,
      });
    }
    if (allMessages.length >= 20) break; // Cap to avoid huge context injection
  }

  return allMessages.slice(0, 20);
}

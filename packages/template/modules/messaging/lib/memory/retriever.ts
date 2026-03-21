import type { VobaseDb } from '@vobase/core';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { cosineDistance } from 'drizzle-orm/sql/functions/vector';

import { buildRankMap, computeRRFScores } from '../../../../lib/search-utils';
import { embedQuery } from '../../../knowledge-base/lib/embeddings';
import { msgMessages } from '../../schema';
import { msgMemCells, msgMemEpisodes, msgMemEventLogs } from './schema';
import type { MemoryRetrievalResult, MemoryScope } from './types';

interface RetrieveOptions {
  limit?: number;
}

/**
 * Build a scope WHERE condition. MemoryScope guarantees at least one of
 * contactId or userId is set, but TypeScript can't narrow the union across
 * the ternary — so we cast the userId branch (safe per resolveScope contract).
 */
function episodeScopeCond(scope: MemoryScope) {
  return scope.contactId
    ? eq(msgMemEpisodes.contactId, scope.contactId)
    : eq(msgMemEpisodes.userId, scope.userId as string);
}

function factScopeCond(scope: MemoryScope) {
  return scope.contactId
    ? eq(msgMemEventLogs.contactId, scope.contactId)
    : eq(msgMemEventLogs.userId, scope.userId as string);
}

function cellScopeCond(scope: MemoryScope) {
  return scope.contactId
    ? eq(msgMemCells.contactId, scope.contactId)
    : eq(msgMemCells.userId, scope.userId as string);
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
      id: msgMemEpisodes.id,
      cellId: msgMemEpisodes.cellId,
      title: msgMemEpisodes.title,
      content: msgMemEpisodes.content,
      distance: cosineDistance(msgMemEpisodes.embedding, queryEmbedding),
    })
    .from(msgMemEpisodes)
    .where(scopeCond)
    .orderBy(cosineDistance(msgMemEpisodes.embedding, queryEmbedding))
    .limit(fetchCount);

  // Keyword search
  let keyword: typeof vector = [];
  if (query.trim()) {
    try {
      keyword = await db
        .select({
          id: msgMemEpisodes.id,
          cellId: msgMemEpisodes.cellId,
          title: msgMemEpisodes.title,
          content: msgMemEpisodes.content,
          distance: sql<number>`0`,
        })
        .from(msgMemEpisodes)
        .where(
          and(
            scopeCond,
            sql`${msgMemEpisodes.searchVector} @@ websearch_to_tsquery('english', ${query})`,
          ),
        )
        .orderBy(
          sql`ts_rank(${msgMemEpisodes.searchVector}, websearch_to_tsquery('english', ${query})) DESC`,
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
      id: msgMemEventLogs.id,
      cellId: msgMemEventLogs.cellId,
      fact: msgMemEventLogs.fact,
      subject: msgMemEventLogs.subject,
      distance: cosineDistance(msgMemEventLogs.embedding, queryEmbedding),
    })
    .from(msgMemEventLogs)
    .where(scopeCond)
    .orderBy(cosineDistance(msgMemEventLogs.embedding, queryEmbedding))
    .limit(fetchCount);

  // Keyword search
  let keyword: typeof vector = [];
  if (query.trim()) {
    try {
      keyword = await db
        .select({
          id: msgMemEventLogs.id,
          cellId: msgMemEventLogs.cellId,
          fact: msgMemEventLogs.fact,
          subject: msgMemEventLogs.subject,
          distance: sql<number>`0`,
        })
        .from(msgMemEventLogs)
        .where(
          and(
            scopeCond,
            sql`${msgMemEventLogs.searchVector} @@ websearch_to_tsquery('english', ${query})`,
          ),
        )
        .orderBy(
          sql`ts_rank(${msgMemEventLogs.searchVector}, websearch_to_tsquery('english', ${query})) DESC`,
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
      id: msgMemCells.id,
      threadId: msgMemCells.threadId,
      startMessageId: msgMemCells.startMessageId,
      endMessageId: msgMemCells.endMessageId,
    })
    .from(msgMemCells)
    .where(and(inArray(msgMemCells.id, uniqueCellIds), scopeCond));

  if (cells.length === 0) return [];

  // Collect all boundary message IDs to resolve timestamps
  const allBoundaryIds = cells.flatMap((c) => [
    c.startMessageId,
    c.endMessageId,
  ]);

  const boundaryMessages = await db
    .select({
      id: msgMessages.id,
      createdAt: msgMessages.createdAt,
    })
    .from(msgMessages)
    .where(inArray(msgMessages.id, allBoundaryIds));

  const timestampMap = new Map(
    boundaryMessages.map((m) => [m.id, m.createdAt]),
  );

  // Build a single batched query using UNION-style OR conditions across all cell ranges.
  // Each cell contributes a (threadId, startTime, endTime) range.
  const rangeConditions = cells
    .map((cell) => {
      const startTime = timestampMap.get(cell.startMessageId);
      const endTime = timestampMap.get(cell.endMessageId);
      if (!startTime || !endTime) return null;
      return and(
        eq(msgMessages.threadId, cell.threadId),
        gte(msgMessages.createdAt, startTime),
        lte(msgMessages.createdAt, endTime),
      );
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (rangeConditions.length === 0) return [];

  // Single query for all cells — OR across ranges, cap total results
  const condition =
    rangeConditions.length === 1
      ? rangeConditions[0]
      : sql`(${sql.join(
          rangeConditions.map((c) => sql`(${c})`),
          sql` OR `,
        )})`;

  const msgs = await db
    .select({
      content: msgMessages.content,
      aiRole: msgMessages.aiRole,
      createdAt: msgMessages.createdAt,
    })
    .from(msgMessages)
    .where(condition)
    .orderBy(msgMessages.createdAt)
    .limit(20); // Cap to avoid huge context injection

  return msgs.map((m) => ({
    content: m.content ?? '',
    role: m.aiRole ?? 'user',
    createdAt: m.createdAt,
  }));
}

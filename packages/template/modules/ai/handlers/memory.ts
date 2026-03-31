import { getCtx, notFound, unauthorized, validation } from '@vobase/core';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { aiMemCells, aiMemEpisodes, aiMemEventLogs } from '../schema';
import {
  buildCursor,
  paginationSchema,
  parseCursor,
  parseScope,
  scopeSchema,
} from './_shared';

export const memoryHandlers = new Hono()
  /** GET /memory/stats?scope=contact:ID|user:ID */
  .get('/memory/stats', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rawScope = c.req.query('scope');
    if (!rawScope)
      throw validation({ scope: 'Required. Format: contact:ID or user:ID' });

    const parsed = scopeSchema.safeParse(rawScope);
    if (!parsed.success) throw validation({ scope: parsed.error.message });

    const scope = parseScope(rawScope);

    // Scope is validated — exactly one of contactId/userId is set
    const isContact = 'contactId' in scope;
    const scopeId = isContact ? scope.contactId : scope.userId;
    if (!scopeId) throw validation({ scope: 'Scope ID is empty' });
    const cellWhere = isContact
      ? eq(aiMemCells.contactId, scopeId)
      : eq(aiMemCells.userId, scopeId);
    const episodeWhere = isContact
      ? eq(aiMemEpisodes.contactId, scopeId)
      : eq(aiMemEpisodes.userId, scopeId);
    const factWhere = isContact
      ? eq(aiMemEventLogs.contactId, scopeId)
      : eq(aiMemEventLogs.userId, scopeId);

    const [cellCount] = await db
      .select({ count: count() })
      .from(aiMemCells)
      .where(cellWhere);

    const [episodeCount] = await db
      .select({ count: count() })
      .from(aiMemEpisodes)
      .where(episodeWhere);

    const [factCount] = await db
      .select({ count: count() })
      .from(aiMemEventLogs)
      .where(factWhere);

    return c.json({
      cells: cellCount?.count ?? 0,
      episodes: episodeCount?.count ?? 0,
      facts: factCount?.count ?? 0,
    });
  })
  /** GET /memory/search?q=...&scope=contact:ID|user:ID */
  .get('/memory/search', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rawScope = c.req.query('scope');
    const query = c.req.query('q');
    if (!rawScope)
      throw validation({ scope: 'Required. Format: contact:ID or user:ID' });
    if (!query) throw validation({ q: 'Required. Search query.' });

    const parsed = scopeSchema.safeParse(rawScope);
    if (!parsed.success) throw validation({ scope: parsed.error.message });

    const scope = parseScope(rawScope);
    if (!('contactId' in scope) || !scope.contactId) {
      throw validation({
        scope: 'Memory search requires contact:ID scope',
      });
    }

    const { retrieveMemory } = await import(
      '../../../mastra/processors/memory/retriever'
    );
    const result = await retrieveMemory(
      db,
      { contactId: scope.contactId },
      query,
    );
    return c.json(result);
  })
  /** GET /memory/episodes?scope=contact:ID|user:ID&cursor=&limit= */
  .get('/memory/episodes', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rawScope = c.req.query('scope');
    if (!rawScope)
      throw validation({ scope: 'Required. Format: contact:ID or user:ID' });

    const parsed = scopeSchema.safeParse(rawScope);
    if (!parsed.success) throw validation({ scope: parsed.error.message });

    const { cursor, limit } = paginationSchema.parse({
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
    });

    const scope = parseScope(rawScope);
    const isContact = 'contactId' in scope;
    const scopeId = isContact ? scope.contactId : scope.userId;
    if (!scopeId) throw validation({ scope: 'Scope ID is empty' });
    const episodeWhere = isContact
      ? eq(aiMemEpisodes.contactId, scopeId)
      : eq(aiMemEpisodes.userId, scopeId);

    const cursorFilter = cursor ? parseCursor(cursor) : null;
    const conditions = cursorFilter
      ? and(
          episodeWhere,
          sql`(${aiMemEpisodes.createdAt} < ${cursorFilter.ts} OR (${aiMemEpisodes.createdAt} = ${cursorFilter.ts} AND ${aiMemEpisodes.id} < ${cursorFilter.id}))`,
        )
      : episodeWhere;

    const episodes = await db
      .select({
        id: aiMemEpisodes.id,
        cellId: aiMemEpisodes.cellId,
        title: aiMemEpisodes.title,
        content: aiMemEpisodes.content,
        createdAt: aiMemEpisodes.createdAt,
        threadId: aiMemCells.threadId,
        factCount: sql<number>`cast(count(${aiMemEventLogs.id}) as int)`,
      })
      .from(aiMemEpisodes)
      .leftJoin(aiMemCells, eq(aiMemEpisodes.cellId, aiMemCells.id))
      .leftJoin(aiMemEventLogs, eq(aiMemEpisodes.cellId, aiMemEventLogs.cellId))
      .where(conditions)
      .groupBy(aiMemEpisodes.id, aiMemCells.threadId)
      .orderBy(desc(aiMemEpisodes.createdAt), desc(aiMemEpisodes.id))
      .limit(limit + 1);

    const hasMore = episodes.length > limit;
    const page = hasMore ? episodes.slice(0, limit) : episodes;
    const lastItem = page[page.length - 1];
    const nextCursor = hasMore && lastItem ? buildCursor(lastItem) : null;

    return c.json({ episodes: page, nextCursor });
  })
  /** GET /memory/facts?scope=contact:ID|user:ID&episodeId=&cursor=&limit= */
  .get('/memory/facts', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rawScope = c.req.query('scope');
    if (!rawScope)
      throw validation({ scope: 'Required. Format: contact:ID or user:ID' });

    const parsed = scopeSchema.safeParse(rawScope);
    if (!parsed.success) throw validation({ scope: parsed.error.message });

    const { cursor, limit } = paginationSchema.parse({
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
    });

    const episodeId = c.req.query('episodeId');

    const scope = parseScope(rawScope);
    const isContact = 'contactId' in scope;
    const scopeId = isContact ? scope.contactId : scope.userId;
    if (!scopeId) throw validation({ scope: 'Scope ID is empty' });
    const factWhere = isContact
      ? eq(aiMemEventLogs.contactId, scopeId)
      : eq(aiMemEventLogs.userId, scopeId);

    const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [
      factWhere,
    ];
    const cursorFilter = cursor ? parseCursor(cursor) : null;
    if (cursorFilter) {
      conditions.push(
        sql`(${aiMemEventLogs.createdAt} < ${cursorFilter.ts} OR (${aiMemEventLogs.createdAt} = ${cursorFilter.ts} AND ${aiMemEventLogs.id} < ${cursorFilter.id}))`,
      );
    }

    // Filter by episode: episode and facts share the same cellId
    if (episodeId) {
      const episode = (
        await db
          .select({ cellId: aiMemEpisodes.cellId })
          .from(aiMemEpisodes)
          .where(eq(aiMemEpisodes.id, episodeId))
      )[0];
      if (!episode) throw notFound('Episode not found');
      conditions.push(eq(aiMemEventLogs.cellId, episode.cellId));
    }

    const facts = await db
      .select({
        id: aiMemEventLogs.id,
        cellId: aiMemEventLogs.cellId,
        fact: aiMemEventLogs.fact,
        subject: aiMemEventLogs.subject,
        occurredAt: aiMemEventLogs.occurredAt,
        createdAt: aiMemEventLogs.createdAt,
      })
      .from(aiMemEventLogs)
      .where(and(...conditions))
      .orderBy(desc(aiMemEventLogs.createdAt), desc(aiMemEventLogs.id))
      .limit(limit + 1);

    const hasMore = facts.length > limit;
    const page = hasMore ? facts.slice(0, limit) : facts;
    const lastFact = page[page.length - 1];
    const nextCursor = hasMore && lastFact ? buildCursor(lastFact) : null;

    return c.json({ facts: page, nextCursor });
  })
  /** DELETE /memory/facts/:id */
  .delete('/memory/facts/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const factId = c.req.param('id');

    const fact = (
      await db
        .select({
          id: aiMemEventLogs.id,
          contactId: aiMemEventLogs.contactId,
          userId: aiMemEventLogs.userId,
        })
        .from(aiMemEventLogs)
        .where(eq(aiMemEventLogs.id, factId))
    )[0];
    if (!fact) throw notFound('Fact not found');

    // Verify scope ownership: user-scoped facts must match, contact-scoped facts require user relationship
    if (fact.userId && fact.userId !== user.id) throw unauthorized();
    if (fact.contactId && !fact.userId) {
      // Contact-scoped facts: any authenticated user may manage them
      // (conversation ownership check will be added when conversations module is wired)
    }

    const deleted = await db
      .delete(aiMemEventLogs)
      .where(eq(aiMemEventLogs.id, factId))
      .returning({ id: aiMemEventLogs.id });

    if (deleted.length === 0) throw notFound('Fact not found');

    return c.json({ success: true });
  })
  /** DELETE /memory/episodes/:id */
  .delete('/memory/episodes/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const episodeId = c.req.param('id');

    const episode = (
      await db
        .select({
          id: aiMemEpisodes.id,
          cellId: aiMemEpisodes.cellId,
          contactId: aiMemEpisodes.contactId,
          userId: aiMemEpisodes.userId,
        })
        .from(aiMemEpisodes)
        .where(eq(aiMemEpisodes.id, episodeId))
    )[0];
    if (!episode) throw notFound('Episode not found');

    // Verify scope ownership: user-scoped episodes must match, contact-scoped require user relationship
    if (episode.userId && episode.userId !== user.id) throw unauthorized();
    if (episode.contactId && !episode.userId) {
      // Contact-scoped episodes: any authenticated user may manage them
      // (conversation ownership check will be added when conversations module is wired)
    }

    // Delete associated facts sharing the same cellId, then the episode
    await db
      .delete(aiMemEventLogs)
      .where(eq(aiMemEventLogs.cellId, episode.cellId));

    await db.delete(aiMemEpisodes).where(eq(aiMemEpisodes.id, episodeId));

    return c.json({ success: true });
  })
  /** GET /memory/working?scope=contact:ID — Get Mastra working memory for each thread */
  .get('/memory/working', async (c) => {
    const { user } = getCtx(c);
    if (!user) throw unauthorized();

    const rawScope = c.req.query('scope');
    if (!rawScope)
      throw validation({ scope: 'Required. Format: contact:ID or user:ID' });

    const parsed = scopeSchema.safeParse(rawScope);
    if (!parsed.success) throw validation({ scope: parsed.error.message });

    const resourceId = rawScope; // e.g. "contact:abc123"

    try {
      const { getMemory } = await import('../../../mastra/index');
      const memory = getMemory();

      // Working memory is stored per resource (e.g. "contact:abc123")
      const wm = await memory
        .getWorkingMemory({ threadId: '', resourceId })
        .catch(() => null);

      return c.json({
        workingMemory: wm,
        resourceId,
      });
    } catch {
      return c.json({ workingMemory: null, resourceId });
    }
  });

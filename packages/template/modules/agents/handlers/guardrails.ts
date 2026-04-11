import { getCtx, unauthorized } from '@vobase/core';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { Hono } from 'hono';

import { aiModerationLogs } from '../schema';
import { buildCursor, paginationSchema, parseCursor } from './_shared';

export const guardrailsHandlers = new Hono()
  /** GET /guardrails/config — returns active guardrail rules and config */
  .get('/guardrails/config', async (c) => {
    const { user } = getCtx(c);
    if (!user) throw unauthorized();

    // Config is code-defined — expose defaults for the UI
    return c.json({
      rules: [
        {
          id: 'content-moderation',
          name: 'Content Moderation',
          type: 'input-processor',
          config: {
            blocklist: [] as string[],
            maxLength: 10_000,
          },
          appliedTo: 'all-agents',
        },
      ],
    });
  })
  /** GET /guardrails/logs?cursor=&limit= — paginated moderation event log */
  .get('/guardrails/logs', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const { cursor, limit } = paginationSchema.parse({
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
    });

    const cursorFilter = cursor ? parseCursor(cursor) : null;
    const conditions = cursorFilter
      ? or(
          lt(aiModerationLogs.createdAt, cursorFilter.ts),
          and(
            eq(aiModerationLogs.createdAt, cursorFilter.ts),
            lt(aiModerationLogs.id, cursorFilter.id),
          ),
        )
      : undefined;

    const logs = await db
      .select({
        id: aiModerationLogs.id,
        agentId: aiModerationLogs.agentId,
        channel: aiModerationLogs.channel,
        userId: aiModerationLogs.userId,
        contactId: aiModerationLogs.contactId,
        conversationId: aiModerationLogs.threadId,
        reason: aiModerationLogs.reason,
        blockedContent: aiModerationLogs.blockedContent,
        matchedTerm: aiModerationLogs.matchedTerm,
        createdAt: aiModerationLogs.createdAt,
      })
      .from(aiModerationLogs)
      .where(conditions)
      .orderBy(desc(aiModerationLogs.createdAt), desc(aiModerationLogs.id))
      .limit(limit + 1);

    const hasMore = logs.length > limit;
    const page = hasMore ? logs.slice(0, limit) : logs;
    const lastItem = page[page.length - 1];
    const nextCursor = hasMore && lastItem ? buildCursor(lastItem) : null;

    return c.json({ logs: page, nextCursor });
  });

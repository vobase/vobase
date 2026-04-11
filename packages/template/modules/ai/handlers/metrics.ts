import { getCtx, unauthorized } from '@vobase/core';
import { and, count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { listAgents } from '../../../mastra/agents';
import { conversations, messages } from '../schema';

export const metricsHandlers = new Hono().get('/agents/metrics', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const agents = listAgents();

  // Active sessions per agent
  const activeCounts = await db
    .select({
      agentId: conversations.agentId,
      activeCount: count(),
    })
    .from(conversations)
    .where(eq(conversations.status, 'active'))
    .groupBy(conversations.agentId);

  // Queued outgoing messages per agent (via conversation join)
  const queuedCounts = await db
    .select({
      agentId: conversations.agentId,
      queuedCount: count(),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(eq(messages.messageType, 'outgoing'), eq(messages.status, 'queued')),
    )
    .groupBy(conversations.agentId);

  // Weighted success score per agent (outcome-based)
  // resolved=1.0, escalated=0.5, failed=0.0, abandoned=0.0
  // Exclude topic_change outcomes — they represent continuations, not resolutions
  const successScores = await db
    .select({
      agentId: conversations.agentId,
      score: sql<number>`
          CASE WHEN COUNT(*) FILTER (WHERE ${conversations.outcome} IS NOT NULL AND ${conversations.outcome} != 'topic_change') = 0 THEN 0
          ELSE (
            COUNT(*) FILTER (WHERE ${conversations.outcome} = 'resolved') * 1.0 +
            COUNT(*) FILTER (WHERE ${conversations.outcome} = 'escalated') * 0.5
          ) / NULLIF(COUNT(*) FILTER (WHERE ${conversations.outcome} IS NOT NULL AND ${conversations.outcome} != 'topic_change'), 0)
          END
        `.as('score'),
    })
    .from(conversations)
    .where(sql`${conversations.status} IN ('resolved', 'failed')`)
    .groupBy(conversations.agentId);

  // Merge results
  const activeMap = new Map(
    activeCounts.map((r) => [r.agentId, Number(r.activeCount)]),
  );
  const queuedMap = new Map(
    queuedCounts.map((r) => [r.agentId, Number(r.queuedCount)]),
  );
  const scoreMap = new Map(
    successScores.map((r) => [r.agentId, Number(r.score)]),
  );

  const metrics = agents.map((a) => ({
    agentId: a.meta.id,
    name: a.meta.name,
    model: a.meta.model,
    channels: a.meta.channels ?? ['web'],
    activeCount: activeMap.get(a.meta.id) ?? 0,
    queuedCount: queuedMap.get(a.meta.id) ?? 0,
    successScore: scoreMap.get(a.meta.id) ?? 0,
  }));

  return c.json({ agents: metrics });
});

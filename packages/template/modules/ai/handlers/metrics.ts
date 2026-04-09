import { getCtx, unauthorized } from '@vobase/core';
import { and, count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { listAgents } from '../../../mastra/agents';
import { interactions, messages } from '../schema';

export const metricsHandlers = new Hono().get('/agents/metrics', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const agents = listAgents();

  // Active sessions per agent
  const activeCounts = await db
    .select({
      agentId: interactions.agentId,
      activeCount: count(),
    })
    .from(interactions)
    .where(eq(interactions.status, 'active'))
    .groupBy(interactions.agentId);

  // Queued outgoing messages per agent (via interaction join)
  const queuedCounts = await db
    .select({
      agentId: interactions.agentId,
      queuedCount: count(),
    })
    .from(messages)
    .innerJoin(interactions, eq(messages.interactionId, interactions.id))
    .where(
      and(eq(messages.messageType, 'outgoing'), eq(messages.status, 'queued')),
    )
    .groupBy(interactions.agentId);

  // Weighted success score per agent (outcome-based)
  // resolved=1.0, escalated=0.5, failed=0.0, abandoned=0.0
  // Exclude topic_change outcomes — they represent continuations, not resolutions
  const successScores = await db
    .select({
      agentId: interactions.agentId,
      score: sql<number>`
          CASE WHEN COUNT(*) FILTER (WHERE ${interactions.outcome} IS NOT NULL AND ${interactions.outcome} != 'topic_change') = 0 THEN 0
          ELSE (
            COUNT(*) FILTER (WHERE ${interactions.outcome} = 'resolved') * 1.0 +
            COUNT(*) FILTER (WHERE ${interactions.outcome} = 'escalated') * 0.5
          ) / NULLIF(COUNT(*) FILTER (WHERE ${interactions.outcome} IS NOT NULL AND ${interactions.outcome} != 'topic_change'), 0)
          END
        `.as('score'),
    })
    .from(interactions)
    .where(sql`${interactions.status} IN ('resolved', 'failed')`)
    .groupBy(interactions.agentId);

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

import { getCtx, unauthorized } from '@vobase/core';
import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { activityEvents, conversations } from '../schema';

export const dashboardHandlers = new Hono().get('/dashboard', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // All queries in parallel
  const [attentionResult, activeResult, resolvedResult, avgResponseResult] =
    await Promise.all([
      // Needs attention count (must match attention queue definition)
      db
        .select({ count: count() })
        .from(activityEvents)
        .where(
          and(
            inArray(activityEvents.type, [
              'escalation.created',
              'guardrail.block',
            ]),
            eq(activityEvents.resolutionStatus, 'pending'),
          ),
        ),

      // Active sessions
      db
        .select({ count: count() })
        .from(conversations)
        .where(eq(conversations.status, 'active')),

      // Resolved today
      db
        .select({ count: count() })
        .from(conversations)
        .where(
          and(
            eq(conversations.status, 'completed'),
            gte(conversations.endedAt, todayStart),
          ),
        ),

      // Average response time (first outbox message - conversation start)
      db
        .select({
          avgMs: sql<number>`
              AVG(EXTRACT(EPOCH FROM (
                (SELECT MIN(o.created_at) FROM conversations.outbox o WHERE o.conversation_id = ${conversations.id})
                - ${conversations.startedAt}
              )) * 1000)
            `.as('avg_ms'),
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.status, 'completed'),
            gte(conversations.endedAt, todayStart),
          ),
        ),
    ]);

  return c.json({
    needsAttentionCount: Number(attentionResult[0]?.count ?? 0),
    activeSessions: Number(activeResult[0]?.count ?? 0),
    resolvedToday: Number(resolvedResult[0]?.count ?? 0),
    avgResponseTimeMs: Math.round(Number(avgResponseResult[0]?.avgMs ?? 0)),
  });
});

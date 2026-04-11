import { getCtx, unauthorized } from '@vobase/core';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { conversations, messages } from '../../messaging/schema';

export const dashboardHandlers = new Hono().get('/dashboard', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // All queries in parallel
  const [attentionResult, activeResult, resolvedResult, avgResponseResult] =
    await Promise.all([
      // Needs attention count: pending activity messages with escalation/guardrail event types
      db
        .select({ count: count() })
        .from(messages)
        .where(
          and(
            eq(messages.messageType, 'activity'),
            eq(messages.resolutionStatus, 'pending'),
            sql`${messages.contentData}->>'eventType' IN ('escalation.created', 'guardrail.block')`,
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
            eq(conversations.status, 'resolved'),
            gte(conversations.resolvedAt, todayStart),
          ),
        ),

      // Average response time (first outgoing message - conversation start)
      db
        .select({
          avgMs: sql<number>`
              AVG(EXTRACT(EPOCH FROM (
                (SELECT MIN(m.created_at) FROM ${messages} m WHERE m.conversation_id = ${conversations.id} AND m.message_type = 'outgoing')
                - ${conversations.startedAt}
              )) * 1000)
            `.as('avg_ms'),
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.status, 'resolved'),
            gte(conversations.resolvedAt, todayStart),
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

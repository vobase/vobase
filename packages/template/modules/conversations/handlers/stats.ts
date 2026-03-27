import { getCtx, unauthorized } from '@vobase/core';
import { count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { consultations, conversations } from '../schema';

export const statsHandlers = new Hono()
  /** GET /stats — Per-agent consultation count + error rate for dashboard. */
  .get('/stats', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    // Per-agent conversation counts (total + failed)
    const conversationStats = await db
      .select({
        agentId: conversations.agentId,
        total: count(),
        failed: count(
          sql`CASE WHEN ${conversations.status} = 'failed' THEN 1 END`,
        ),
      })
      .from(conversations)
      .groupBy(conversations.agentId);

    // Per-agent consultation counts (via conversation → consultation join)
    const consultationStats = await db
      .select({
        agentId: conversations.agentId,
        consultations: count(),
      })
      .from(consultations)
      .innerJoin(
        conversations,
        eq(consultations.conversationId, conversations.id),
      )
      .groupBy(conversations.agentId);

    // Merge into a map
    const statsMap = new Map<
      string,
      {
        total: number;
        failed: number;
        consultations: number;
        errorRate: number;
      }
    >();

    for (const row of conversationStats) {
      statsMap.set(row.agentId, {
        total: Number(row.total),
        failed: Number(row.failed),
        consultations: 0,
        errorRate:
          Number(row.total) > 0 ? Number(row.failed) / Number(row.total) : 0,
      });
    }

    for (const row of consultationStats) {
      const existing = statsMap.get(row.agentId);
      if (existing) {
        existing.consultations = Number(row.consultations);
      } else {
        statsMap.set(row.agentId, {
          total: 0,
          failed: 0,
          consultations: Number(row.consultations),
          errorRate: 0,
        });
      }
    }

    return c.json(Object.fromEntries(statsMap));
  });

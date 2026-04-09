import { getCtx, unauthorized } from '@vobase/core';
import { count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { consultations, interactions } from '../schema';

export const statsHandlers = new Hono()
  /** GET /stats — Per-agent consultation count + error rate for dashboard. */
  .get('/stats', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    // Per-agent interaction counts (total + failed)
    const interactionStats = await db
      .select({
        agentId: interactions.agentId,
        total: count(),
        failed: count(
          sql`CASE WHEN ${interactions.status} = 'failed' THEN 1 END`,
        ),
      })
      .from(interactions)
      .groupBy(interactions.agentId);

    // Per-agent consultation counts (via interaction → consultation join)
    const consultationStats = await db
      .select({
        agentId: interactions.agentId,
        consultations: count(),
      })
      .from(consultations)
      .innerJoin(interactions, eq(consultations.interactionId, interactions.id))
      .groupBy(interactions.agentId);

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

    for (const row of interactionStats) {
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

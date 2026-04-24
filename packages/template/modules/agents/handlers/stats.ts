import { getCtx, unauthorized } from '@vobase/core'
import { count, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { conversations } from '../../messaging/schema'

export const statsHandlers = new Hono()
  /** GET /stats — Per-agent error rate for dashboard. */
  .get('/stats', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const conversationStats = await db
      .select({
        agentId: conversations.agentId,
        total: count(),
        failed: count(sql`CASE WHEN ${conversations.status} = 'failed' THEN 1 END`),
      })
      .from(conversations)
      .groupBy(conversations.agentId)

    const statsMap = new Map<string, { total: number; failed: number; errorRate: number }>()

    for (const row of conversationStats) {
      statsMap.set(row.agentId, {
        total: Number(row.total),
        failed: Number(row.failed),
        errorRate: Number(row.total) > 0 ? Number(row.failed) / Number(row.total) : 0,
      })
    }

    return c.json(Object.fromEntries(statsMap))
  })

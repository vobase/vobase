import { getCtx, unauthorized } from '@vobase/core'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { messages } from '../schema'

const activityFilterSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  agentId: z.string().optional(),
  category: z.string().optional(),
  type: z.string().optional(),
  channelType: z.string().optional(),
  contactId: z.string().optional(),
  conversationId: z.string().optional(),
  timeFrom: z.string().optional(),
  timeTo: z.string().optional(),
  resolutionStatus: z.enum(['pending', 'reviewed', 'dismissed']).optional(),
})

const cursorSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
})

export const activityHandlers = new Hono().get('/activity', async (c) => {
  const { db, user } = getCtx(c)
  if (!user) throw unauthorized()

  const params = activityFilterSchema.parse(Object.fromEntries(new URL(c.req.url).searchParams))

  // Base filter: only activity messages
  const conditions = [eq(messages.messageType, 'activity')]

  // contentData may be a JSONB string (double-encoded from seed) or JSONB object.
  // Normalize: if jsonb_typeof = 'string', unwrap with (col #>> '{}')::jsonb
  const cd = sql`(CASE WHEN jsonb_typeof(${messages.contentData}) = 'string' THEN (${messages.contentData} #>> '{}')::jsonb ELSE ${messages.contentData} END)`

  if (params.agentId) conditions.push(sql`${cd}->>'agentId' = ${params.agentId}`)
  if (params.category) conditions.push(sql`${cd}->>'eventType' LIKE ${`${params.category}.%`}`)
  if (params.type) conditions.push(sql`${cd}->>'eventType' = ${params.type}`)
  if (params.channelType) conditions.push(eq(messages.channelType, params.channelType))
  if (params.contactId) conditions.push(sql`${messages.contentData}->>'contactId' = ${params.contactId}`)
  if (params.conversationId) conditions.push(eq(messages.conversationId, params.conversationId))
  if (params.resolutionStatus) conditions.push(eq(messages.resolutionStatus, params.resolutionStatus))
  if (params.timeFrom) conditions.push(gte(messages.createdAt, new Date(params.timeFrom)))
  if (params.timeTo) conditions.push(lte(messages.createdAt, new Date(params.timeTo)))

  // Cursor-based pagination
  if (params.cursor) {
    try {
      const decoded = JSON.parse(atob(params.cursor))
      const cursor = cursorSchema.parse(decoded)
      conditions.push(sql`(${messages.createdAt}, ${messages.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`)
    } catch {
      // Invalid cursor — ignore, return from beginning
    }
  }

  const rows = await db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(params.limit + 1)

  const hasMore = rows.length > params.limit
  const events = hasMore ? rows.slice(0, params.limit) : rows
  const nextCursor =
    hasMore && events.length > 0
      ? btoa(
          JSON.stringify({
            createdAt: events[events.length - 1].createdAt.toISOString(),
            id: events[events.length - 1].id,
          }),
        )
      : null

  // Map to include top-level `type` from contentData.eventType for API compatibility
  // Handle double-encoded JSONB strings (seed data) and normal JSONB objects
  const mapped = events.map((e) => {
    let cd = e.contentData as Record<string, unknown>
    if (typeof cd === 'string') {
      try {
        cd = JSON.parse(cd)
      } catch {
        cd = {}
      }
    }
    return {
      ...e,
      type: cd?.eventType ?? e.content,
      data: cd,
      contentData: cd,
    }
  })

  return c.json({ events: mapped, nextCursor })
})

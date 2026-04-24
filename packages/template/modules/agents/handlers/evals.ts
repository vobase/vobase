import { conflict, getCtx, notFound, unauthorized } from '@vobase/core'
import { and, avg, count, countDistinct, desc, eq, gte, inArray, isNotNull, max, sql } from 'drizzle-orm'
import { doublePrecision, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core'
import { Hono } from 'hono'
import { z } from 'zod'

import { messageFeedback } from '../../messaging/schema'
import { buildCustomScorer } from '../mastra/evals/custom-scorer-factory'
import { getScorerMeta } from '../mastra/evals/scorers'
import { getMastra } from '../mastra/index'

/**
 * Read-only Drizzle reference to Mastra's internal scorers table.
 * Defined locally (not in schema.ts) to avoid drizzle-kit push/migrate
 * trying to manage the `mastra` schema which is owned by PostgresStore.
 */
const mastraPgSchema = pgSchema('mastra')
const mastraScorers = mastraPgSchema.table('mastra_scorers', {
  id: text('id').primaryKey(),
  scorerId: text('scorerId').notNull(),
  score: doublePrecision('score').notNull(),
  reason: text('reason'),
  entityId: text('entityId'),
  source: text('source'),
  threadId: text('threadId'),
  runId: text('runId'),
  requestContext: jsonb('requestContext').$type<Record<string, unknown>>(),
  createdAt: timestamp('createdAt', { withTimezone: true }),
})

const createScorerSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  criteria: z.string().min(10).max(5000),
  model: z.string().min(1),
})

const updateScorerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  criteria: z.string().min(10).max(5000).optional(),
  model: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
})

/** Extract bare conversation ID from Mastra scorer data.
 * threadId format is 'agent-{agentId}-conv-{conversationId}' — extract after 'conv-'.
 * Falls back to requestContext->>'conversationId' if threadId has no match. */
const conversationIdSql = sql<string>`COALESCE(SUBSTRING(${mastraScorers.threadId} FROM 'conv-(.+)$'), ${mastraScorers.requestContext}->>'conversationId')`

/**
 * Safely execute a query against mastra_scorers.
 * Returns fallback if the table doesn't exist yet (42P01).
 * Mastra's PostgresStore creates this table at runtime — it won't exist until first Mastra init.
 */
async function safeScorersQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err: unknown) {
    if (isUndefinedTable(err)) return fallback
    throw err
  }
}

/** Check for 42P01 (undefined_table) on the error or its Drizzle-wrapped cause. */
function isUndefinedTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  if (e.errno === '42P01' || e.code === '42P01') return true
  if (e.cause && typeof e.cause === 'object') {
    const c = e.cause as Record<string, unknown>
    if (c.errno === '42P01' || c.code === '42P01') return true
  }
  return false
}

/** Get the Mastra scorer definitions storage domain. */
async function getScorerDefsStore() {
  const storage = getMastra().getStorage()
  if (!storage) return null
  return storage.getStore('scorerDefinitions')
}

/** Extract scorer metadata fields from a resolved Mastra scorer definition. */
function resolvedDefToMeta(def: Record<string, unknown>) {
  const metadata = (def.metadata ?? {}) as Record<string, unknown>
  return {
    id: `custom-${def.id}`,
    dbId: def.id as string,
    name: (def.name as string) ?? '',
    description: (def.description as string) ?? '',
    criteria: (def.instructions as string) ?? '',
    model: (metadata.model as string) ?? '',
    enabled: def.status !== 'archived',
    hasJudge: true,
    steps: [] as Array<{ name: string; type: string; description?: string }>,
    source: 'custom' as const,
  }
}

export const evalsHandlers = new Hono()
  /** GET /evals/scorers — list all scorers (code + custom from Mastra storage) */
  .get('/evals/scorers', async (c) => {
    const { user } = getCtx(c)
    if (!user) throw unauthorized()

    const codeMeta = getScorerMeta().map((s) => ({
      ...s,
      source: 'code' as const,
    }))

    const store = await getScorerDefsStore()
    if (!store) return c.json(codeMeta)

    const result = (await store.listResolved()) as Record<string, unknown>
    const rawDefs = Array.isArray(result?.scorerDefinitions)
      ? (result.scorerDefinitions as Record<string, unknown>[])
      : []
    const defs = rawDefs.filter((d) => d.status !== 'draft')

    const customMeta = defs.map(resolvedDefToMeta)
    return c.json([...codeMeta, ...customMeta])
  })
  /** POST /evals/scorers — create a custom scorer definition in Mastra storage */
  .post('/evals/scorers', async (c) => {
    const { user } = getCtx(c)
    if (!user) throw unauthorized()

    const body = createScorerSchema.parse(await c.req.json())
    const store = await getScorerDefsStore()
    if (!store) throw conflict('Scorer definitions storage not initialized')

    const def = await store.create({
      scorerDefinition: {
        id: crypto.randomUUID(),
        authorId: user.id,
        name: body.name,
        description: body.description,
        type: 'llm-judge',
        instructions: body.criteria,
        metadata: { model: body.model },
      },
    })

    // Register for live scoring on the Mastra instance
    const scorer = buildCustomScorer({
      id: def.id,
      name: body.name,
      description: body.description,
      criteria: body.criteria,
      model: body.model,
    })
    getMastra().addScorer(scorer)

    return c.json(def, 201)
  })
  /** PATCH /evals/scorers/:id — update a custom scorer definition */
  .patch('/evals/scorers/:id', async (c) => {
    const { user } = getCtx(c)
    if (!user) throw unauthorized()

    const id = c.req.param('id')
    const body = updateScorerSchema.parse(await c.req.json())
    const store = await getScorerDefsStore()
    if (!store) throw conflict('Scorer definitions storage not initialized')

    // Build update payload — map Vobase fields to Mastra scorer definition fields
    const update: {
      id: string
      name?: string
      description?: string
      instructions?: string
      status?: 'draft' | 'published' | 'archived'
      metadata?: Record<string, unknown>
    } = { id }
    if (body.name !== undefined) update.name = body.name
    if (body.description !== undefined) update.description = body.description
    if (body.criteria !== undefined) update.instructions = body.criteria
    if (body.enabled !== undefined) update.status = body.enabled ? 'published' : 'archived'
    if (body.model !== undefined) {
      // Merge with existing metadata to avoid losing other fields
      const existing = (await store.getByIdResolved(id)) as Record<string, unknown> | null
      const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>
      update.metadata = { ...existingMeta, model: body.model }
    }

    const updated = await store.update(update)
    if (!updated) throw notFound('Scorer not found')

    // Re-register scorer if content changed (not just enable/disable)
    if (body.name || body.description || body.criteria || body.model) {
      const resolved = (await store.getByIdResolved(id)) as Record<string, unknown> | null
      if (resolved) {
        const meta = resolvedDefToMeta(resolved)
        const scorer = buildCustomScorer({
          id: id,
          name: meta.name,
          description: meta.description,
          criteria: meta.criteria,
          model: meta.model,
        })
        getMastra().addScorer(scorer)
      }
    }

    return c.json(updated)
  })
  /** DELETE /evals/scorers/:id — delete a custom scorer definition */
  .delete('/evals/scorers/:id', async (c) => {
    const { user } = getCtx(c)
    if (!user) throw unauthorized()

    const id = c.req.param('id')
    const store = await getScorerDefsStore()
    if (!store) throw conflict('Scorer definitions storage not initialized')

    await store.delete(id)
    return c.json({ ok: true })
  })
  /** GET /evals/conversation-scores — batch quality scores for conversation list */
  .get('/evals/conversation-scores', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const idsParam = c.req.query('conversationIds')
    if (!idsParam) return c.json({})

    const ids = idsParam.split(',').filter(Boolean).slice(0, 100)
    if (ids.length === 0) return c.json({})

    const rows = await safeScorersQuery(
      () =>
        db
          .select({
            conversationId: conversationIdSql,
            avgScore: avg(mastraScorers.score).mapWith(Number),
            scoreCount: count(),
          })
          .from(mastraScorers)
          .where(and(eq(mastraScorers.source, 'LIVE'), inArray(conversationIdSql, ids)))
          .groupBy(conversationIdSql),
      [],
    )

    const result: Record<string, { avgScore: number; count: number }> = {}
    for (const row of rows) {
      if (row.conversationId) {
        result[row.conversationId] = {
          avgScore: row.avgScore,
          count: row.scoreCount,
        }
      }
    }
    return c.json(result)
  })
  /** GET /evals/conversation/:conversationId/scores — individual scores for a conversation */
  .get('/evals/conversation/:conversationId/scores', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const conversationId = c.req.param('conversationId')

    const rows = await safeScorersQuery(
      () =>
        db
          .select({
            id: mastraScorers.id,
            scorerId: mastraScorers.scorerId,
            score: mastraScorers.score,
            reason: mastraScorers.reason,
            runId: mastraScorers.runId,
            createdAt: mastraScorers.createdAt,
            requestContext: mastraScorers.requestContext,
          })
          .from(mastraScorers)
          .where(and(eq(mastraScorers.source, 'LIVE'), eq(conversationIdSql, conversationId)))
          .orderBy(desc(mastraScorers.createdAt)),
      [],
    )

    return c.json(rows)
  })
  /** GET /evals/quality-overview — aggregate quality stats for the dashboard */
  .get('/evals/quality-overview', async (c) => {
    const { db, user } = getCtx(c)
    if (!user) throw unauthorized()

    const days = Number.parseInt(c.req.query('days') ?? '7', 10)
    const cutoff = new Date(Date.now() - days * 86_400_000)

    const liveAfterCutoff = and(eq(mastraScorers.source, 'LIVE'), gte(mastraScorers.createdAt, cutoff))

    // Aggregate live scores
    const [scoreStats] = await safeScorersQuery(
      () =>
        db
          .select({
            avgScore: avg(mastraScorers.score).mapWith(Number),
            totalScores: count(),
            conversationsScored: countDistinct(conversationIdSql),
          })
          .from(mastraScorers)
          .where(liveAfterCutoff),
      [
        {
          avgScore: null as unknown as number,
          totalScores: 0,
          conversationsScored: 0,
        },
      ],
    )

    // Per-scorer averages
    const scorerBreakdown = await safeScorersQuery(
      () =>
        db
          .select({
            scorerId: mastraScorers.scorerId,
            avgScore: avg(mastraScorers.score).mapWith(Number),
            count: count(),
          })
          .from(mastraScorers)
          .where(liveAfterCutoff)
          .groupBy(mastraScorers.scorerId)
          .orderBy(avg(mastraScorers.score)),
      [],
    )

    // Human feedback stats
    const [feedbackStats] = await db
      .select({
        positive: count(sql`CASE WHEN ${messageFeedback.rating} = 'positive' THEN 1 END`),
        negative: count(sql`CASE WHEN ${messageFeedback.rating} = 'negative' THEN 1 END`),
      })
      .from(messageFeedback)
      .where(gte(messageFeedback.createdAt, cutoff))

    // Worst conversations (lowest avg score)
    const worstConversations = await safeScorersQuery(
      () =>
        db
          .select({
            conversationId: conversationIdSql,
            avgScore: avg(mastraScorers.score).mapWith(Number),
            scoreCount: count(),
            lastScored: max(mastraScorers.createdAt),
          })
          .from(mastraScorers)
          .where(and(liveAfterCutoff, isNotNull(conversationIdSql)))
          .groupBy(conversationIdSql)
          .orderBy(avg(mastraScorers.score))
          .limit(20),
      [],
    )

    return c.json({
      avgScore: scoreStats?.avgScore ?? null,
      totalScores: scoreStats?.totalScores ?? 0,
      conversationsScored: scoreStats?.conversationsScored ?? 0,
      feedback: {
        positive: feedbackStats?.positive ?? 0,
        negative: feedbackStats?.negative ?? 0,
      },
      scorerBreakdown: scorerBreakdown.map((r) => ({
        scorerId: r.scorerId,
        avgScore: r.avgScore,
        count: r.count,
      })),
      worstConversations: worstConversations.map((r) => ({
        conversationId: r.conversationId,
        avgScore: r.avgScore,
        scoreCount: r.scoreCount,
        lastScored: r.lastScored,
      })),
    })
  })

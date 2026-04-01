import { getCtx, notFound, unauthorized } from '@vobase/core';
import {
  and,
  avg,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  max,
  sql,
} from 'drizzle-orm';
import {
  doublePrecision,
  jsonb,
  pgSchema,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { z } from 'zod';

import { getScorerMeta } from '../../../mastra/evals/scorers';
import { customScorerId } from '../../../mastra/evals/types';
import { aiEvalRuns, aiScorers, messageFeedback } from '../schema';
import { safeJsonParse } from './_shared';

/**
 * Read-only Drizzle reference to Mastra's internal scorers table.
 * Defined locally (not in schema.ts) to avoid drizzle-kit push/migrate
 * trying to manage the `mastra` schema which is owned by PostgresStore.
 */
const mastraPgSchema = pgSchema('mastra');
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
});

const evalRunSchema = z.object({
  agentId: z.string().min(1),
  data: z.array(
    z.object({
      input: z.string(),
      output: z.string(),
      context: z.array(z.string()),
    }),
  ),
});

const createScorerSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  criteria: z.string().min(10).max(5000),
  model: z.string().min(1),
});

const updateScorerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  criteria: z.string().min(10).max(5000).optional(),
  model: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

/** COALESCE(threadId, requestContext->>'conversationId') — resolves conversation ID from Mastra scorer data */
const convId = sql<string>`COALESCE(${mastraScorers.threadId}, ${mastraScorers.requestContext}->>'conversationId')`;

/**
 * Safely execute a query against mastra_scorers.
 * Returns fallback if the table doesn't exist yet (42P01).
 * Mastra's PostgresStore creates this table at runtime — it won't exist until first Mastra init.
 */
async function safeScorersQuery<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (isUndefinedTable(err)) return fallback;
    throw err;
  }
}

/** Check for 42P01 (undefined_table) on the error or its Drizzle-wrapped cause. */
function isUndefinedTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e.errno === '42P01' || e.code === '42P01') return true;
  if (e.cause && typeof e.cause === 'object') {
    const c = e.cause as Record<string, unknown>;
    if (c.errno === '42P01' || c.code === '42P01') return true;
  }
  return false;
}

export const evalsHandlers = new Hono()
  /** GET /evals/scorers — list all scorers (code + custom) */
  .get('/evals/scorers', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const codeMeta = getScorerMeta().map((s) => ({
      ...s,
      source: 'code' as const,
    }));

    const customRows = await db
      .select()
      .from(aiScorers)
      .orderBy(aiScorers.createdAt);

    const customMeta = customRows.map((row) => ({
      id: customScorerId(row.id),
      dbId: row.id,
      name: row.name,
      description: row.description,
      criteria: row.criteria,
      model: row.model,
      enabled: row.enabled,
      hasJudge: true,
      steps: [] as Array<{ name: string; type: string; description?: string }>,
      source: 'custom' as const,
    }));

    return c.json([...codeMeta, ...customMeta]);
  })
  /** POST /evals/scorers — create a custom scorer */
  .post('/evals/scorers', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = createScorerSchema.parse(await c.req.json());

    const [row] = await db
      .insert(aiScorers)
      .values({
        name: body.name,
        description: body.description,
        criteria: body.criteria,
        model: body.model,
        createdBy: user.id,
      })
      .returning();

    return c.json(row, 201);
  })
  /** PATCH /evals/scorers/:id — update a custom scorer */
  .patch('/evals/scorers/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');
    const body = updateScorerSchema.parse(await c.req.json());

    const [updated] = await db
      .update(aiScorers)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(aiScorers.id, id))
      .returning();

    if (!updated) throw notFound('Scorer not found');
    return c.json(updated);
  })
  /** DELETE /evals/scorers/:id — delete a custom scorer */
  .delete('/evals/scorers/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');
    const [deleted] = await db
      .delete(aiScorers)
      .where(eq(aiScorers.id, id))
      .returning({ id: aiScorers.id });

    if (!deleted) throw notFound('Scorer not found');
    return c.json({ ok: true });
  })
  /** GET /evals — list recent eval runs ordered by createdAt desc */
  .get('/evals', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const runs = await db
      .select()
      .from(aiEvalRuns)
      .orderBy(desc(aiEvalRuns.createdAt))
      .limit(20);

    return c.json(
      runs.map((run) => ({
        id: run.id,
        agentId: run.agentId,
        status: run.status,
        itemCount: run.itemCount,
        results: run.status === 'complete' ? safeJsonParse(run.results) : null,
        errorMessage: run.errorMessage,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
      })),
    );
  })
  /** POST /evals/run — create an eval run and queue the scoring job */
  .post('/evals/run', async (c) => {
    const { db, user, scheduler } = getCtx(c);
    if (!user) throw unauthorized();

    const body = evalRunSchema.parse(await c.req.json());

    const [run] = await db
      .insert(aiEvalRuns)
      .values({
        agentId: body.agentId,
        status: 'pending',
        itemCount: body.data.length,
        results: JSON.stringify(body.data),
      })
      .returning();

    await scheduler.add('ai:eval-run', { runId: run.id });

    return c.json({ runId: run.id }, 201);
  })
  /** GET /evals/live — list live scorer results from Mastra storage */
  .get('/evals/live', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await safeScorersQuery(
      () =>
        db
          .select({
            id: mastraScorers.id,
            scorerId: mastraScorers.scorerId,
            score: mastraScorers.score,
            reason: mastraScorers.reason,
            createdAt: mastraScorers.createdAt,
            agentId: mastraScorers.entityId,
            conversationId: convId,
          })
          .from(mastraScorers)
          .where(eq(mastraScorers.source, 'LIVE'))
          .orderBy(desc(mastraScorers.createdAt))
          .limit(100),
      [],
    );

    return c.json(rows);
  })
  /** GET /evals/conversation-scores — batch quality scores for conversation list */
  .get('/evals/conversation-scores', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const idsParam = c.req.query('conversationIds');
    if (!idsParam) return c.json({});

    const ids = idsParam.split(',').filter(Boolean).slice(0, 100);
    if (ids.length === 0) return c.json({});

    const rows = await safeScorersQuery(
      () =>
        db
          .select({
            convId,
            avgScore: avg(mastraScorers.score).mapWith(Number),
            scoreCount: count(),
          })
          .from(mastraScorers)
          .where(and(eq(mastraScorers.source, 'LIVE'), inArray(convId, ids)))
          .groupBy(convId),
      [],
    );

    const result: Record<string, { avgScore: number; count: number }> = {};
    for (const row of rows) {
      if (row.convId) {
        result[row.convId] = {
          avgScore: row.avgScore,
          count: row.scoreCount,
        };
      }
    }
    return c.json(result);
  })
  /** GET /evals/conversation/:conversationId/scores — individual scores for a conversation */
  .get('/evals/conversation/:conversationId/scores', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const conversationId = c.req.param('conversationId');

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
          })
          .from(mastraScorers)
          .where(
            and(eq(mastraScorers.source, 'LIVE'), eq(convId, conversationId)),
          )
          .orderBy(desc(mastraScorers.createdAt)),
      [],
    );

    return c.json(rows);
  })
  /** GET /evals/quality-overview — aggregate quality stats for the dashboard */
  .get('/evals/quality-overview', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const days = Number.parseInt(c.req.query('days') ?? '7', 10);
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const liveAfterCutoff = and(
      eq(mastraScorers.source, 'LIVE'),
      gte(mastraScorers.createdAt, cutoff),
    );

    // Aggregate live scores
    const [scoreStats] = await safeScorersQuery(
      () =>
        db
          .select({
            avgScore: avg(mastraScorers.score).mapWith(Number),
            totalScores: count(),
            conversationsScored: countDistinct(convId),
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
    );

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
    );

    // Human feedback stats
    const [feedbackStats] = await db
      .select({
        positive: count(
          sql`CASE WHEN ${messageFeedback.rating} = 'positive' THEN 1 END`,
        ),
        negative: count(
          sql`CASE WHEN ${messageFeedback.rating} = 'negative' THEN 1 END`,
        ),
      })
      .from(messageFeedback)
      .where(gte(messageFeedback.createdAt, cutoff));

    // Worst conversations (lowest avg score)
    const worstConversations = await safeScorersQuery(
      () =>
        db
          .select({
            conversationId: convId,
            avgScore: avg(mastraScorers.score).mapWith(Number),
            scoreCount: count(),
            lastScored: max(mastraScorers.createdAt),
          })
          .from(mastraScorers)
          .where(and(liveAfterCutoff, isNotNull(convId)))
          .groupBy(convId)
          .orderBy(avg(mastraScorers.score))
          .limit(20),
      [],
    );

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
    });
  })
  /** GET /evals/:runId — fetch eval run status + results */
  .get('/evals/:runId', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const run = (
      await db
        .select()
        .from(aiEvalRuns)
        .where(eq(aiEvalRuns.id, c.req.param('runId')))
    )[0];
    if (!run) throw notFound('Eval run not found');

    return c.json({
      id: run.id,
      agentId: run.agentId,
      status: run.status,
      itemCount: run.itemCount,
      results: run.status === 'complete' ? safeJsonParse(run.results) : null,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    });
  });

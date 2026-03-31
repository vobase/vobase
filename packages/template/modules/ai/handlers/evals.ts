import { getCtx, notFound, unauthorized } from '@vobase/core';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getScorerMeta } from '../../../mastra/evals/scorers';
import { getMastra } from '../../../mastra/index';
import { aiEvalRuns, aiScorers } from '../schema';
import { safeJsonParse } from './_shared';

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

export const evalsHandlers = new Hono()
  /** GET /evals/scorers — list all scorers (code + custom) */
  .get('/evals/scorers', async (c) => {
    const { db } = getCtx(c);

    const codeMeta = getScorerMeta().map((s) => ({
      ...s,
      source: 'code' as const,
    }));

    const customRows = await db
      .select()
      .from(aiScorers)
      .orderBy(aiScorers.createdAt);

    const customMeta = customRows.map((row) => ({
      id: `custom-${row.id}`,
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
    const { user } = getCtx(c);
    if (!user) throw unauthorized();

    const mastra = getMastra();
    const storage = mastra.getStorage();
    if (!storage) return c.json([]);

    const scoresStorage = await storage.getStore('scores');
    if (!scoresStorage) return c.json([]);

    const scorerMeta = getScorerMeta();
    const allScores: Array<{
      id: string;
      scorerId: string;
      score: number;
      reason?: string;
      createdAt: Date;
      agentId?: string;
    }> = [];

    for (const scorer of scorerMeta) {
      try {
        const result = await scoresStorage.listScoresByScorerId({
          scorerId: scorer.id,
          pagination: { page: 1, perPage: 50 },
          source: 'LIVE',
        });
        for (const row of result.scores) {
          allScores.push({
            id: row.id,
            scorerId: row.scorerId,
            score: row.score,
            reason: row.reason,
            createdAt: row.createdAt,
            agentId: row.entityId,
          });
        }
      } catch {
        // Scores domain may not be available
      }
    }

    allScores.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return c.json(allScores);
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

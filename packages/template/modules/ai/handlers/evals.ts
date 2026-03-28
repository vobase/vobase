import { getCtx, notFound, unauthorized } from '@vobase/core';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { aiEvalRuns } from '../schema';
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

export const evalsHandlers = new Hono()
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
        // Store input data temporarily in results column; job replaces with scored results
        results: JSON.stringify(body.data),
      })
      .returning();

    await scheduler.add('ai:eval-run', { runId: run.id });

    return c.json({ runId: run.id }, 201);
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

import { getCtx, notFound, unauthorized } from '@vobase/core';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { aiWorkflowRuns } from '../schema';
import {
  buildCursor,
  paginationSchema,
  parseCursor,
  safeJsonParse,
} from './_shared';

const workflowRunsSchema = paginationSchema.extend({
  status: z.enum(['running', 'suspended', 'completed', 'failed']).optional(),
});

const workflowRegistry: {
  id: string;
  name: string;
  description: string;
  steps: { id: string; name: string; description: string; type: string }[];
}[] = [];

export const workflowsHandlers = new Hono()
  /** GET /workflows/registry — returns registered workflow definitions with run counts */
  .get('/workflows/registry', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const runCounts = await db
      .select({
        workflowId: aiWorkflowRuns.workflowId,
        count: count(),
      })
      .from(aiWorkflowRuns)
      .groupBy(aiWorkflowRuns.workflowId);

    const countMap = new Map(runCounts.map((r) => [r.workflowId, r.count]));

    const workflows = workflowRegistry.map((meta) => ({
      ...meta,
      stepCount: meta.steps.length,
      runCount: countMap.get(meta.id) ?? 0,
    }));

    return c.json({ workflows });
  })
  /** GET /workflows/:workflowId/runs?cursor=&limit=&status= — paginated run history */
  .get('/workflows/:workflowId/runs', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const workflowId = c.req.param('workflowId');
    const { cursor, limit, status } = workflowRunsSchema.parse({
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
      status: c.req.query('status'),
    });

    const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [
      eq(aiWorkflowRuns.workflowId, workflowId),
      eq(aiWorkflowRuns.userId, user.id),
    ];

    if (status) {
      conditions.push(eq(aiWorkflowRuns.status, status));
    }

    const cursorFilter = cursor ? parseCursor(cursor) : null;
    if (cursorFilter) {
      conditions.push(
        sql`(${aiWorkflowRuns.createdAt} < ${cursorFilter.ts} OR (${aiWorkflowRuns.createdAt} = ${cursorFilter.ts} AND ${aiWorkflowRuns.id} < ${cursorFilter.id}))`,
      );
    }

    const runs = await db
      .select({
        id: aiWorkflowRuns.id,
        workflowId: aiWorkflowRuns.workflowId,
        status: aiWorkflowRuns.status,
        inputData: aiWorkflowRuns.inputData,
        suspendPayload: aiWorkflowRuns.suspendPayload,
        outputData: aiWorkflowRuns.outputData,
        createdAt: aiWorkflowRuns.createdAt,
        updatedAt: aiWorkflowRuns.updatedAt,
      })
      .from(aiWorkflowRuns)
      .where(and(...conditions))
      .orderBy(desc(aiWorkflowRuns.createdAt), desc(aiWorkflowRuns.id))
      .limit(limit + 1);

    const hasMore = runs.length > limit;
    const page = hasMore ? runs.slice(0, limit) : runs;
    const lastItem = page[page.length - 1];
    const nextCursor = hasMore && lastItem ? buildCursor(lastItem) : null;

    return c.json({
      runs: page.map((r) => ({
        ...r,
        inputData: safeJsonParse(r.inputData),
        suspendPayload: safeJsonParse(r.suspendPayload),
        outputData: safeJsonParse(r.outputData),
      })),
      nextCursor,
    });
  })
  /** GET /workflows/:workflowId/runs/:runId — get a specific workflow run */
  .get('/workflows/:workflowId/runs/:runId', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const run = (
      await db
        .select()
        .from(aiWorkflowRuns)
        .where(
          and(
            eq(aiWorkflowRuns.id, c.req.param('runId')),
            eq(aiWorkflowRuns.workflowId, c.req.param('workflowId')),
            eq(aiWorkflowRuns.userId, user.id),
          ),
        )
    )[0];
    if (!run) throw notFound('Workflow run not found');

    return c.json({
      id: run.id,
      workflowId: run.workflowId,
      status: run.status,
      inputData: safeJsonParse(run.inputData),
      suspendPayload: safeJsonParse(run.suspendPayload),
      outputData: safeJsonParse(run.outputData),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
  });

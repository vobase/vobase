import { logger, validation } from '@vobase/core';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getModuleDb } from '../lib/automation-deps';
import { scriptAuthMiddleware } from '../lib/script-auth';
import { updateHeartbeat } from '../lib/sessions';
import {
  cancelTask,
  claimNextTask,
  completeTask,
  failTask,
} from '../lib/tasks';
import { automationTasks } from '../schema';

// Per-session poll rate limiter: 1 poll every 2 seconds
const POLL_INTERVAL_MS = 2_000;
const lastPollTime = new Map<string, number>();

export const scriptHandlers = new Hono()
  .use(scriptAuthMiddleware)

  // ─── Poll for next task ───────────────────────────────────────────
  .get('/poll', async (c) => {
    const userId = c.get('automationUserId');
    const sessionId = c.get('automationSessionId');

    const now = Date.now();
    const lastPoll = lastPollTime.get(sessionId);
    if (lastPoll && now - lastPoll < POLL_INTERVAL_MS) {
      return new Response(null, { status: 429 });
    }
    lastPollTime.set(sessionId, now);

    const task = await claimNextTask(userId, sessionId);

    if (task) {
      const payload = {
        taskId: task.id,
        adapterId: task.adapterId,
        action: task.action,
        input: task.input,
        requiresApproval: task.requiresApproval,
      };
      logger.info('[automation] Task claimed', payload);
      return c.json(payload);
    }

    return new Response(null, { status: 204 });
  })

  // ─── Report task result ───────────────────────────────────────────
  .post('/report', async (c) => {
    const reportSchema = z.object({
      taskId: z.string().min(1),
      status: z.enum(['completed', 'failed', 'cancelled']),
      output: z.record(z.string(), z.unknown()).optional(),
      error: z.string().optional(),
      domSnapshot: z.string().max(100_000).optional(),
    });

    const parsed = reportSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }

    const { taskId, status, output, error, domSnapshot } = parsed.data;
    const sessionId = c.get('automationSessionId');

    // Verify task belongs to this session and is in executing state
    const db = getModuleDb();
    const [task] = await db
      .select({
        id: automationTasks.id,
        status: automationTasks.status,
      })
      .from(automationTasks)
      .where(
        and(
          eq(automationTasks.id, taskId),
          eq(automationTasks.sessionId, sessionId),
        ),
      )
      .limit(1);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    if (task.status !== 'executing') {
      return c.json(
        { error: `Task is in '${task.status}' state, expected 'executing'` },
        409,
      );
    }

    if (status === 'completed') {
      await completeTask(taskId, output ?? {});
    } else if (status === 'failed') {
      await failTask(taskId, error ?? 'Unknown error', domSnapshot);
    } else {
      await cancelTask(taskId);
    }

    logger.info(`[automation] Task ${taskId} reported as ${status}`);
    return c.json({ success: true });
  })

  // ─── Heartbeat ────────────────────────────────────────────────────
  .post('/heartbeat', async (c) => {
    const sessionId = c.get('automationSessionId');
    await updateHeartbeat(sessionId);
    return new Response(null, { status: 204 });
  });

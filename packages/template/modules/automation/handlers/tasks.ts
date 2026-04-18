import {
  forbidden,
  getCtx,
  notFound,
  unauthorized,
  validation,
} from '@vobase/core';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getModuleDb } from '../lib/automation-deps';
import { cancelTask, createTask } from '../lib/tasks';
import { automationSessions, automationTasks } from '../schema';

const taskStatusSchema = z
  .enum(['pending', 'executing', 'completed', 'failed', 'timeout', 'cancelled'])
  .optional();

const TASK_PAGE_LIMIT = 100;

export const taskHandlers = new Hono()

  // ─── List tasks ───────────────────────────────────────────────────
  .get('/', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const status = taskStatusSchema.parse(c.req.query('status'));
    const db = getModuleDb();

    const tasks = status
      ? await db
          .select()
          .from(automationTasks)
          .where(eq(automationTasks.status, status))
          .orderBy(desc(automationTasks.createdAt))
          .limit(TASK_PAGE_LIMIT)
      : await db
          .select()
          .from(automationTasks)
          .orderBy(desc(automationTasks.createdAt))
          .limit(TASK_PAGE_LIMIT);

    // Strip sensitive browser data from list view
    const sanitized = tasks.map(
      ({ domSnapshot, errorMessage, ...rest }) => rest,
    );
    return c.json(sanitized);
  })

  // ─── Create task (staff-initiated) ───────────────────────────────
  .post('/', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const createSchema = z.object({
      adapterId: z.string().min(1),
      action: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
      assignedTo: z.string().optional(),
      sourceConversationId: z.string().optional(),
      timeoutMinutes: z.number().int().positive().optional(),
    });

    const parsed = createSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }

    const task = await createTask({
      ...parsed.data,
      requestedBy: 'staff',
    });

    return c.json(task, 201);
  })

  // ─── Get single task ──────────────────────────────────────────────
  .get('/:id', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const id = c.req.param('id');
    const db = getModuleDb();

    const [task] = await db
      .select()
      .from(automationTasks)
      .where(eq(automationTasks.id, id))
      .limit(1);

    if (!task) throw notFound('Task');

    // Only show sensitive browser data to the session owner or admin
    let isSessionOwner = ctx.user.role === 'admin';
    if (!isSessionOwner && task.sessionId) {
      const [session] = await db
        .select({ userId: automationSessions.userId })
        .from(automationSessions)
        .where(eq(automationSessions.id, task.sessionId))
        .limit(1);
      isSessionOwner = session?.userId === ctx.user.id;
    }

    if (!isSessionOwner) {
      const { domSnapshot, errorMessage, ...safe } = task;
      return c.json(safe);
    }

    return c.json(task);
  })

  // ─── Cancel task ──────────────────────────────────────────────────
  .post('/:id/cancel', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const id = c.req.param('id');
    const db = getModuleDb();

    const [task] = await db
      .select({
        id: automationTasks.id,
        status: automationTasks.status,
        assignedTo: automationTasks.assignedTo,
      })
      .from(automationTasks)
      .where(eq(automationTasks.id, id))
      .limit(1);

    if (!task) throw notFound('Task');

    // Only the assignee or an admin can cancel
    if (
      task.assignedTo &&
      task.assignedTo !== ctx.user.id &&
      ctx.user.role !== 'admin'
    ) {
      throw forbidden('You can only cancel tasks assigned to you');
    }

    const cancelled = await cancelTask(id);
    if (!cancelled) {
      return c.json({ error: 'Task is not in a cancellable state' }, 409);
    }

    return c.json({ success: true });
  });

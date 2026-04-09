import { and, eq, inArray, sql } from 'drizzle-orm';

import { automationTasks } from '../schema';
import { getModuleDb, getModuleDeps } from './deps';

export const TASK_STATUSES = [
  'pending',
  'executing',
  'completed',
  'failed',
  'timeout',
  'cancelled',
] as const;

const REQUESTED_BY = ['ai', 'staff', 'system'] as const;
type RequestedBy = (typeof REQUESTED_BY)[number];

/** Return orphaned tasks (assigned/executing) back to pending for a given session. */
export async function unassignOrphanedTasks(sessionId: string): Promise<void> {
  const db = getModuleDb();
  const deps = getModuleDeps();

  await db
    .update(automationTasks)
    .set({ status: 'pending', sessionId: null })
    .where(
      and(
        eq(automationTasks.sessionId, sessionId),
        eq(automationTasks.status, 'executing'),
      ),
    );

  deps.realtime.notify({ table: 'automation-tasks', action: 'update' });
}

export async function createTask(input: {
  adapterId: string;
  action: string;
  input: Record<string, unknown>;
  assignedTo?: string;
  requestedBy: RequestedBy;
  requiresApproval?: boolean;
  sourceInteractionId?: string;
  timeoutMinutes?: number;
}): Promise<typeof automationTasks.$inferSelect> {
  const db = getModuleDb();
  const deps = getModuleDeps();

  const [task] = await db
    .insert(automationTasks)
    .values({
      adapterId: input.adapterId,
      action: input.action,
      input: input.input,
      assignedTo: input.assignedTo ?? null,
      requestedBy: input.requestedBy,
      requiresApproval: input.requiresApproval ?? false,
      sourceInteractionId: input.sourceInteractionId ?? null,
      timeoutMinutes: input.timeoutMinutes ?? 10,
      status: 'pending',
    })
    .returning();

  if (!task) {
    throw new Error('Failed to create automation task');
  }

  deps.realtime.notify({ table: 'automation-tasks', action: 'insert' });

  return task;
}

/**
 * Atomically claim the next pending task for a user.
 * Uses FOR UPDATE SKIP LOCKED to prevent race conditions
 * when multiple browsers poll concurrently.
 */
export async function claimNextTask(
  userId: string,
  sessionId: string,
): Promise<typeof automationTasks.$inferSelect | null> {
  const db = getModuleDb();
  const deps = getModuleDeps();

  // Atomic claim: raw SQL for FOR UPDATE SKIP LOCKED (not supported by Drizzle).
  // Only returns the ID — re-fetch via Drizzle for properly-mapped camelCase columns.
  const result = await db.execute(sql`
    UPDATE ${automationTasks}
    SET status = 'executing', session_id = ${sessionId}, updated_at = now()
    WHERE id = (
      SELECT id FROM ${automationTasks}
      WHERE status = 'pending'
        AND (assigned_to = ${userId} OR assigned_to IS NULL)
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  // bun-sql driver returns rows as array directly, not { rows: [...] }
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const claimedId = (rows[0] as Record<string, unknown>)?.id as
    | string
    | undefined;
  if (!claimedId) return null;

  deps.realtime.notify({ table: 'automation-tasks', action: 'update' });

  const [task] = await db
    .select()
    .from(automationTasks)
    .where(eq(automationTasks.id, claimedId))
    .limit(1);

  return task ?? null;
}

export async function completeTask(
  taskId: string,
  output: Record<string, unknown>,
): Promise<void> {
  const db = getModuleDb();
  const deps = getModuleDeps();

  const [updated] = await db
    .update(automationTasks)
    .set({ status: 'completed', output })
    .where(
      and(
        eq(automationTasks.id, taskId),
        eq(automationTasks.status, 'executing'),
      ),
    )
    .returning({ id: automationTasks.id });

  if (updated) {
    deps.realtime.notify({ table: 'automation-tasks', action: 'update' });
  }
}

export async function failTask(
  taskId: string,
  errorMessage: string,
  domSnapshot?: string,
): Promise<void> {
  const db = getModuleDb();
  const deps = getModuleDeps();

  const [updated] = await db
    .update(automationTasks)
    .set({
      status: 'failed',
      errorMessage,
      domSnapshot: domSnapshot ?? null,
    })
    .where(
      and(
        eq(automationTasks.id, taskId),
        eq(automationTasks.status, 'executing'),
      ),
    )
    .returning({ id: automationTasks.id });

  if (updated) {
    deps.realtime.notify({ table: 'automation-tasks', action: 'update' });
  }
}

export async function cancelTask(taskId: string): Promise<boolean> {
  const db = getModuleDb();
  const deps = getModuleDeps();

  const [updated] = await db
    .update(automationTasks)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(automationTasks.id, taskId),
        inArray(automationTasks.status, ['pending', 'executing']),
      ),
    )
    .returning({ id: automationTasks.id });

  if (updated) {
    deps.realtime.notify({ table: 'automation-tasks', action: 'update' });
    return true;
  }
  return false;
}

import { defineJob, logger } from '@vobase/core';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { getModuleDb, getModuleDeps } from './lib/automation-deps';
import { HEARTBEAT_STALE_MS } from './lib/sessions';
import { unassignOrphanedTasks } from './lib/tasks';
import { automationSessions, automationTasks } from './schema';

/**
 * automation:task-timeout — Find tasks in assigned/executing past their timeout, mark as timeout.
 */
export const taskTimeoutJob = defineJob('automation:task-timeout', async () => {
  const db = getModuleDb();
  const deps = getModuleDeps();

  const timedOut = await db
    .select({ id: automationTasks.id })
    .from(automationTasks)
    .where(
      and(
        eq(automationTasks.status, 'executing'),
        lt(
          sql`${automationTasks.updatedAt} + (${automationTasks.timeoutMinutes} * interval '1 minute')`,
          sql`now()`,
        ),
      ),
    );

  if (timedOut.length === 0) return;

  const ids = timedOut.map((t) => t.id);
  await db
    .update(automationTasks)
    .set({ status: 'timeout' })
    .where(inArray(automationTasks.id, ids));

  deps.realtime.notify({ table: 'automation-tasks', action: 'update' });

  logger.info('[automation] Task timeout job: timed out tasks', {
    count: timedOut.length,
  });
});

/**
 * automation:session-cleanup — Mark sessions disconnected if lastHeartbeat > stale threshold,
 * then unassign orphaned tasks back to pending.
 */
export const sessionCleanupJob = defineJob(
  'automation:session-cleanup',
  async () => {
    const db = getModuleDb();
    const cutoff = new Date(Date.now() - HEARTBEAT_STALE_MS);

    const staleSessions = await db
      .select({ id: automationSessions.id })
      .from(automationSessions)
      .where(
        and(
          eq(automationSessions.status, 'active'),
          isNotNull(automationSessions.lastHeartbeat),
          lt(automationSessions.lastHeartbeat, cutoff),
        ),
      );

    if (staleSessions.length === 0) return;

    const sessionIds = staleSessions.map((s) => s.id);
    await db
      .update(automationSessions)
      .set({ status: 'disconnected' })
      .where(inArray(automationSessions.id, sessionIds));

    for (const id of sessionIds) {
      await unassignOrphanedTasks(id);
    }

    logger.info(
      '[automation] Session cleanup job: disconnected stale sessions',
      {
        count: staleSessions.length,
      },
    );
  },
);

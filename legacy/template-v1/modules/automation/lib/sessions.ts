import { logger } from '@vobase/core'
import { and, eq, gt, sql } from 'drizzle-orm'

import { automationSessions } from '../schema'
import { getModuleDb, getModuleDeps } from './automation-deps'
import { unassignOrphanedTasks } from './tasks'

/** Heartbeat staleness threshold — sessions without a heartbeat for this long are considered disconnected. */
export const HEARTBEAT_STALE_MS = 2 * 60 * 1000

export async function updateHeartbeat(sessionId: string): Promise<void> {
  const db = getModuleDb()

  await db.update(automationSessions).set({ lastHeartbeat: sql`now()` }).where(eq(automationSessions.id, sessionId))
}

export async function disconnectSession(sessionId: string): Promise<void> {
  const db = getModuleDb()
  const deps = getModuleDeps()
  logger.info(`[automation] Disconnecting session ${sessionId}`)

  // Fetch the session to get the apiKeyId before disconnecting
  const [session] = await db
    .select({ apiKeyId: automationSessions.apiKeyId })
    .from(automationSessions)
    .where(eq(automationSessions.id, sessionId))
    .limit(1)

  await db.update(automationSessions).set({ status: 'disconnected' }).where(eq(automationSessions.id, sessionId))

  await unassignOrphanedTasks(sessionId)

  // Revoke the associated API key so it can't be reused
  if (session?.apiKeyId) {
    const revoked = await deps.auth.revokeApiKey(session.apiKeyId)
    if (revoked) {
      logger.info(`[automation] Revoked API key ${session.apiKeyId} for session ${sessionId}`)
    }
  }
}

export async function getActiveSessions(): Promise<(typeof automationSessions.$inferSelect)[]> {
  const db = getModuleDb()
  const cutoff = new Date(Date.now() - HEARTBEAT_STALE_MS)

  return db
    .select()
    .from(automationSessions)
    .where(and(eq(automationSessions.status, 'active'), gt(automationSessions.lastHeartbeat, cutoff)))
}

import { logger } from '@vobase/core'
import { and, eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'

import { automationSessions } from '../schema'
import { getModuleDb, getModuleDeps } from './automation-deps'

declare module 'hono' {
  interface ContextVariableMap {
    automationUserId: string
    automationSessionId: string
  }
}

export const scriptAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    logger.warn('[automation] Missing or invalid Authorization header')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const key = authHeader.slice(7)
  const deps = getModuleDeps()

  const result = await deps.auth.verifyApiKey(key)
  if (!result) {
    logger.warn('[automation] API key verification failed')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Look up the active session for this user
  const db = getModuleDb()
  const [session] = await db
    .select()
    .from(automationSessions)
    .where(and(eq(automationSessions.userId, result.userId), eq(automationSessions.status, 'active')))
    .limit(1)

  if (!session) {
    logger.warn(`[automation] No active session for user ${result.userId}`)
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('automationUserId', result.userId)
  c.set('automationSessionId', session.id)
  await next()
})

import { getCtx, unauthorized } from '@vobase/core'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { pairingHandlers } from './handlers/pairing'
import { scriptHandlers } from './handlers/script'
import { taskHandlers } from './handlers/tasks'
import { compileScript } from './lib/compile'
import { disconnectSession, getActiveSessions } from './lib/sessions'
import { automationSessions } from './schema'

export type AutomationRoutes = typeof automationRoutes

export const automationRoutes = new Hono()
  // Public: no auth required — browser fetches this to trigger TamperMonkey install
  .get('/script.user.js', async (c) => {
    try {
      const baseUrl = new URL(c.req.url).origin
      const script = await compileScript(baseUrl)
      return new Response(script, {
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Compilation failed'
      return new Response(`// ERROR: ${msg}`, {
        status: 500,
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      })
    }
  })
  .get('/sessions', async (c) => {
    const ctx = getCtx(c)
    if (!ctx.user) throw unauthorized()
    const sessions = await getActiveSessions()
    return c.json(sessions)
  })
  .post('/sessions/:id/disconnect', async (c) => {
    const ctx = getCtx(c)
    if (!ctx.user) throw unauthorized()
    const sessionId = c.req.param('id')
    const [session] = await ctx.db
      .select({ userId: automationSessions.userId })
      .from(automationSessions)
      .where(eq(automationSessions.id, sessionId))
      .limit(1)
    if (!session || session.userId !== ctx.user.id) {
      return c.json({ error: 'Not found' }, 404)
    }
    await disconnectSession(sessionId)
    return c.json({ success: true })
  })
  .route('/pairing', pairingHandlers)
  .route('/tasks', taskHandlers)
  .route('/script', scriptHandlers)

/**
 * Hono app factory. Phase 2: wires real module handlers + SSE.
 * Call `createApp(db)` from the entry point after db is ready.
 * The `app` export is kept for backward compatibility with any test imports.
 */

import inboxHandlers from '@modules/inbox/handlers'
import { setDb as setConversationsDb } from '@modules/inbox/service/conversations'
import { setDb as setMessagesDb } from '@modules/inbox/service/messages'
import { setDb as setPendingApprovalsDb } from '@modules/inbox/service/pending-approvals'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import sseRoute from './routes/sse'

export function createApp(db: unknown): Hono {
  setConversationsDb(db)
  setMessagesDb(db)
  setPendingApprovalsDb(db)

  const app = new Hono()
  app.use('*', cors())
  app.get('/health', (c) => c.json({ ok: true, phase: 2 }))
  app.route('/api/inbox', inboxHandlers)
  app.route('/api/sse', sseRoute)
  return app
}

// Stub used when the entry point hasn't called createApp() yet.
export const app = new Hono()
app.get('/health', (c) => c.json({ ok: true, phase: 1 }))

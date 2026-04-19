/**
 * Hono app factory. Phase 2: wires real module handlers + SSE.
 * Call `createApp(db)` from the entry point after db is ready.
 * The `app` export is kept for backward compatibility with any test imports.
 */

import agentsHandlers from '@modules/agents/handlers'
import {
  createLearningNotifier,
  setNotifier as setLearningNotifier,
  setDb as setLearningProposalsDb,
} from '@modules/agents/service/learning-proposals'
import inboxHandlers from '@modules/inbox/handlers'
import { setDb as setConversationsDb } from '@modules/inbox/service/conversations'
import { setDb as setMessagesDb } from '@modules/inbox/service/messages'
import { setDb as setNotesDb } from '@modules/inbox/service/notes'
import { setDb as setPendingApprovalsDb } from '@modules/inbox/service/pending-approvals'
import { setDb as setStaffOpsDb } from '@modules/inbox/service/staff-ops'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import sseRoute from './routes/sse'

export function createApp(db: unknown): Hono {
  setConversationsDb(db)
  setMessagesDb(db)
  setNotesDb(db)
  setPendingApprovalsDb(db)
  setStaffOpsDb(db)
  setLearningProposalsDb(db)
  setLearningNotifier(createLearningNotifier(db))

  const app = new Hono()
  app.use('*', cors())
  app.get('/health', (c) => c.json({ ok: true, phase: 3 }))
  app.route('/api/inbox', inboxHandlers)
  app.route('/api/agents', agentsHandlers)
  app.route('/api/sse', sseRoute)
  return app
}

// Stub used when the entry point hasn't called createApp() yet.
export const app = new Hono()
app.get('/health', (c) => c.json({ ok: true, phase: 1 }))

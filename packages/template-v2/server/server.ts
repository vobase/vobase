/**
 * Hono app factory. Phase 2: wires real module handlers + SSE.
 * Call `createApp(db, sql)` from the entry point after db is ready.
 * The `app` export is kept for backward compatibility with any test imports.
 */

import agentsHandlers from '@modules/agents/handlers'
import {
  createLearningNotifier,
  setNotifier as setLearningNotifier,
  setDb as setLearningProposalsDb,
} from '@modules/agents/service/learning-proposals'
import channelWebHandlers from '@modules/channel-web/handlers'
import { INBOUND_TO_WAKE_JOB } from '@modules/channel-web/jobs'
import {
  setContactsPort as setChannelWebContacts,
  setInboxPort as setChannelWebInbox,
  setJobQueue as setChannelWebJobs,
  setRealtime as setChannelWebRealtime,
} from '@modules/channel-web/service/state'
import inboxHandlers from '@modules/inbox/handlers'
import { setDb as setConversationsDb } from '@modules/inbox/service/conversations'
import { setDb as setMessagesDb } from '@modules/inbox/service/messages'
import { setDb as setNotesDb } from '@modules/inbox/service/notes'
import { setDb as setPendingApprovalsDb } from '@modules/inbox/service/pending-approvals'
import { setDb as setStaffOpsDb } from '@modules/inbox/service/staff-ops'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Sql } from 'postgres'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import sseRoute from './routes/sse'
import { createAuth } from './auth'
import { buildDevPorts } from './runtime/dev-ports'
import { createLiveAgentHandler } from './runtime/live-agent'
import { createStubAgentHandler } from './runtime/stub-agent'

export function createApp(db: unknown, sql?: Sql): Hono {
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

  const auth = createAuth(db as PostgresJsDatabase)
  app.on(['GET', 'POST'], '/api/auth/**', (c) => auth.handler(c.req.raw))

  app.route('/api/inbox', inboxHandlers)
  app.route('/api/agents', agentsHandlers)
  app.route('/api/sse', sseRoute)

  // Channel-web: dev-only. The inbound webhook's fallback HMAC secret is 'dev-secret',
  // and the live-agent path wires a throw-proxy-free DrivePort/AgentsPort with permissive
  // dev defaults. Gating on NODE_ENV prevents accidental exposure in production builds
  // if something ever calls createApp(db, sql) outside the dev entry point.
  const isDev = process.env.NODE_ENV !== 'production'
  if (sql && isDev) {
    const jobHandlers = new Map<string, (data: unknown) => Promise<void>>()
    const ports = buildDevPorts(db, sql, jobHandlers)
    setChannelWebInbox(ports.inbox)
    setChannelWebContacts(ports.contacts)
    setChannelWebRealtime(ports.realtime)
    setChannelWebJobs(ports.jobs)

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY
    if (anthropicApiKey) {
      console.log('[server] ANTHROPIC_API_KEY present — routing /test-web through real wake engine')
      jobHandlers.set(
        INBOUND_TO_WAKE_JOB,
        createLiveAgentHandler({
          inbox: ports.inbox,
          contacts: ports.contacts,
          agents: ports.agents,
          drive: ports.drive,
          realtime: ports.realtime,
          anthropicApiKey,
        }),
      )
    } else {
      console.log('[server] no ANTHROPIC_API_KEY — /test-web will use canned stub-agent replies')
      jobHandlers.set(INBOUND_TO_WAKE_JOB, createStubAgentHandler({ inbox: ports.inbox, realtime: ports.realtime }))
    }
    app.route('/api/channel-web', channelWebHandlers)
  }

  return app
}

// Stub used when the entry point hasn't called createApp() yet.
export const app = new Hono()
app.get('/health', (c) => c.json({ ok: true, phase: 1 }))

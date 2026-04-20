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
import channelWebHandlers from '@modules/channels/web/handlers'
import { INBOUND_TO_WAKE_JOB } from '@modules/channels/web/jobs'
import {
  setContactsPort as setChannelWebContacts,
  setInboxPort as setChannelWebInbox,
  setJobQueue as setChannelWebJobs,
  setRealtime as setChannelWebRealtime,
} from '@modules/channels/web/service/state'
import channelWhatsappHandlers from '@modules/channels/whatsapp/handlers'
import {
  setContactsPort as setWhatsappContacts,
  setInboxPort as setWhatsappInbox,
  setJobQueue as setWhatsappJobs,
  setRealtime as setWhatsappRealtime,
} from '@modules/channels/whatsapp/service/state'
import contactsHandlers from '@modules/contacts/handlers'
import { setDb as setContactsDb } from '@modules/contacts/service/contacts'
import inboxHandlers from '@modules/inbox/handlers'
import { setDb as setConversationsDb } from '@modules/inbox/service/conversations'
import { setDb as setMessagesDb } from '@modules/inbox/service/messages'
import { setDb as setNotesDb } from '@modules/inbox/service/notes'
import { setDb as setPendingApprovalsDb } from '@modules/inbox/service/pending-approvals'
import { setDb as setStaffOpsDb } from '@modules/inbox/service/staff-ops'
import settingsHandlers from '@modules/settings/handlers'
import systemHandlers from '@modules/system/handlers'
import { setDb as setSystemDb } from '@modules/system/service'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Sql } from 'postgres'
import { createAuth } from './auth'
import sseRoute from './routes/sse'
import { buildDevPorts } from './runtime/dev-ports'
import { createLiveAgentHandler } from './runtime/live-agent'
import { createStubAgentHandler } from './runtime/stub-agent'

export function createApp(db: unknown, sql?: Sql): Hono {
  setConversationsDb(db)
  setMessagesDb(db)
  setNotesDb(db)
  setPendingApprovalsDb(db)
  setStaffOpsDb(db)
  setContactsDb(db)
  setLearningProposalsDb(db)
  setLearningNotifier(createLearningNotifier(db))
  setSystemDb(db)

  const app = new Hono()
  app.use('*', cors())
  app.use('*', logger())
  app.get('/health', (c) => c.json({ ok: true, phase: 3 }))

  const auth = createAuth(db as PostgresJsDatabase)
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  // Session guard for staff-facing API routes. Every request under these prefixes
  // must carry a valid better-auth session cookie; inbound channel webhooks sign
  // themselves with HMAC (separate trust model) and /api/sse authenticates inside
  // its own handler, so both stay outside this gate.
  type AppSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
  type SessionEnv = { Variables: { session: AppSession } }
  const requireSession = async (
    c: import('hono').Context<SessionEnv>,
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'unauthenticated' }, 401)
    c.set('session', session)
    return next()
  }
  app.use('/api/inbox/*', requireSession)
  app.use('/api/agents/*', requireSession)
  app.use('/api/contacts/*', requireSession)
  app.use('/api/settings/*', requireSession)
  app.use('/api/system/*', requireSession)

  app.route('/api/inbox', inboxHandlers)
  app.route('/api/agents', agentsHandlers)
  app.route('/api/contacts', contactsHandlers)
  app.route('/api/settings', settingsHandlers)
  app.route('/api/system', systemHandlers)
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

  // Channel-whatsapp: mount when META_WA_TOKEN + META_WA_VERIFY_TOKEN are set (matching
  // vobase.config.ts:63 `whatsapp.enabled` gate). The webhook endpoint is PUBLIC — Meta
  // authenticates via HMAC (X-Hub-Signature-256), not session cookies.
  // In dev without env vars, we still mount so the route is reachable; requireWebhookSecret()
  // falls back to 'dev-webhook-secret' and emits a console.warn.
  if (sql) {
    const jobHandlers = new Map<string, (data: unknown) => Promise<void>>()
    const ports = buildDevPorts(db, sql, jobHandlers)
    setWhatsappInbox(ports.inbox)
    setWhatsappContacts(ports.contacts)
    setWhatsappRealtime(ports.realtime)
    setWhatsappJobs(ports.jobs)
    app.route('/api/channel-whatsapp', channelWhatsappHandlers)
  }

  return app
}

// Stub used when the entry point hasn't called createApp() yet.
export const app = new Hono()
app.get('/health', (c) => c.json({ ok: true, phase: 1 }))

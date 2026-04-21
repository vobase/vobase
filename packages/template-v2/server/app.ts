import { INBOUND_TO_WAKE_JOB } from '@modules/channels/web/jobs'
import type { CaptionPort } from '@server/contracts/caption-port'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import type { Sql } from 'postgres'
import config from '../vobase.config'
import { createAuth } from './auth'
import { wireAuthIntoModules } from './auth/wire-modules'
import { buildDevPorts } from './dev/dev-ports'
import { createLiveAgentHandler } from './dev/live-agent'
import { createStubAgentHandler } from './dev/stub-agent'
import { createRequireSession, createWidgetCors } from './middlewares'
import sseRoute from './routes/sse'
import { bootModules } from './runtime/boot-modules'

export async function createApp(db: ScopedDb, sql: Sql): Promise<Hono> {
  const app = new Hono()
  app.use('*', createWidgetCors())
  app.use('*', logger())
  app.get('/health', (c) => c.json({ ok: true }))

  const auth = createAuth(db)
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  const requireSession = createRequireSession(auth)

  // Dev ports + in-process job queue drive the channel modules' wake
  // dispatch. Production replaces these with the pg-boss-backed harness.
  const jobHandlers = new Map<string, (data: unknown) => Promise<void>>()
  const devPorts = buildDevPorts(db, sql, jobHandlers)
  // CaptionPort has no dev implementation — Gemini-backed only. Throw-proxy
  // keeps the PluginContext shape satisfied; modules that reach for caption
  // at boot fail loudly.
  const captionThrow = (): never => {
    throw new Error('CaptionPort unavailable in dev — wire CAPTION_PROVIDER=gemini + GOOGLE_API_KEY')
  }
  const caption: CaptionPort = {
    captionImage: captionThrow,
    captionVideo: captionThrow,
    extractText: captionThrow,
  }
  const ports = { ...devPorts, caption }

  await bootModules({
    modules: config.modules,
    app,
    ctx: {
      ports,
      db,
      jobs: ports.jobs,
      storage: {
        getBucket: () => {
          throw new Error('ScopedStorage not configured — no module declared manifest.buckets')
        },
      },
      realtime: ports.realtime,
      logger: {
        debug: () => undefined,
        info: (obj, msg) => console.info('[boot]', msg ?? '', obj ?? ''),
        warn: (obj, msg) => console.warn('[boot]', msg ?? '', obj ?? ''),
        error: (obj, msg) => console.error('[boot]', msg ?? '', obj ?? ''),
      },
      metrics: {
        increment: () => undefined,
        gauge: () => undefined,
        timing: () => undefined,
      },
    },
    requireSession,
  })

  await wireAuthIntoModules(auth)

  app.route('/api/sse', sseRoute)

  // Dev wake dispatch: stub replies when there's no LLM key, real Anthropic
  // otherwise. Lives here (not in channel-web/module.ts) because it composes
  // runtime services — the module shouldn't know about LLM providers.
  if (process.env.NODE_ENV !== 'production') {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY
    if (anthropicApiKey) {
      console.log('[server] ANTHROPIC_API_KEY present — routing /test-web through real wake engine')
      jobHandlers.set(
        INBOUND_TO_WAKE_JOB,
        createLiveAgentHandler({
          inbox: devPorts.inbox,
          contacts: devPorts.contacts,
          agents: devPorts.agents,
          drive: devPorts.drive,
          realtime: devPorts.realtime,
          anthropicApiKey,
        }),
      )
    } else {
      console.log('[server] no ANTHROPIC_API_KEY — /test-web will use canned stub-agent replies')
      jobHandlers.set(
        INBOUND_TO_WAKE_JOB,
        createStubAgentHandler({ inbox: devPorts.inbox, realtime: devPorts.realtime }),
      )
    }
  }

  return app
}

import { INBOUND_TO_WAKE_JOB } from '@modules/channels/web/jobs'
import type { CaptionPort } from '@server/contracts/caption-port'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import type { Sql } from 'postgres'
import config from '../vobase.config'
import { createAuth } from './auth'
import { wireAuthIntoModules } from './auth/wire-modules'
import { createRequireSession, createWidgetCors, installOrganizationContext } from './middlewares'
import { buildPorts } from './ports'
import { createSseRoute } from './routes/sse'
import { bootModules } from './runtime/boot-modules'
import { createWakeHandler } from './wake-handler'

export async function createApp(db: ScopedDb, sql: Sql): Promise<Hono> {
  const app = new Hono()
  app.use('*', createWidgetCors())
  app.use('*', logger())
  app.get('/health', (c) => c.json({ ok: true }))

  const auth = createAuth(db)
  installOrganizationContext({ db, auth })
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  const requireSession = createRequireSession(auth)

  // App ports + in-process job queue drive the channel modules' wake dispatch.
  const jobHandlers = new Map<string, (data: unknown) => Promise<void>>()
  const ports = await buildPorts(db, sql, config.database, jobHandlers)
  // CaptionPort is Gemini-backed only. Throw-proxy keeps the PluginContext
  // shape satisfied; modules that reach for caption at boot fail loudly.
  const captionThrow = (): never => {
    throw new Error('CaptionPort unwired — set CAPTION_PROVIDER=gemini + GOOGLE_API_KEY')
  }
  const caption: CaptionPort = {
    captionImage: captionThrow,
    captionVideo: captionThrow,
    extractText: captionThrow,
  }
  await bootModules({
    modules: config.modules,
    app,
    ctx: {
      caption,
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

  app.route('/api/sse', createSseRoute(ports.realtime))

  // Wake dispatch for the web channel. The pi-agent-core harness reads
  // OPENAI_API_KEY (or BIFROST_API_KEY + BIFROST_URL) from env directly — the
  // handler fails loudly on the first inbound if no key is set.
  jobHandlers.set(
    INBOUND_TO_WAKE_JOB,
    createWakeHandler({
      inbox: ports.inbox,
      contacts: ports.contacts,
      agents: ports.agents,
      drive: ports.drive,
      realtime: ports.realtime,
    }),
  )

  return app
}

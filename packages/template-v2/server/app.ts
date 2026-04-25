import { join } from 'node:path'
import type { ScopedDb } from '@server/common/scoped-db'
import { bootModules, collectAgentContributions, collectJobs, createLogger, sortModules } from '@vobase/core'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { logger } from 'hono/logger'
import type { Sql } from 'postgres'

import config from '../vobase.config'
import { createAuth } from './auth'
import { wireAuthIntoModules } from './auth/wire-modules'
import { createRequireSession, createWidgetCors, installOrganizationContext } from './middlewares'
import { buildPorts } from './module-ports'
import { createSseRoute } from './routes/sse'
import { setDb, setLogger, setRealtime } from './services'
import { createChannelWebTransport } from './transports/web'
import { createChannelWhatsappTransport } from './transports/whatsapp'
import { createWakeHandler, INBOUND_TO_WAKE_JOB } from './wake-handler'

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

  // Process-wide singletons read by listeners that can't receive deps directly
  // (e.g. memory-distill, sse, workspace-sync). Must be set before any wake fires.
  setDb(db)
  setRealtime(ports.realtime)
  setLogger(createLogger({ format: 'console', prefix: '[wake]', silent: ['debug', 'info'] }))

  // Narrow ModuleInitCtx — each module's init(ctx) reads { db, organizationId,
  // jobs, realtime } only. `organizationId` is empty at boot; services that
  // need a real tenant guard reject the empty sentinel at first use.
  await bootModules({
    modules: config.modules,
    app,
    requireSession,
    ctx: {
      db,
      organizationId: '',
      jobs: ports.jobs,
      realtime: ports.realtime,
    },
  })

  // INBOUND_TO_WAKE_JOB binds separately below — bootstrap concern, not a
  // module contribution.
  const sortedModules = sortModules([...config.modules])
  for (const job of collectJobs(sortedModules)) {
    jobHandlers.set(job.name, job.handler)
  }

  // Channel transports are plain infrastructure — NOT modules. They mount
  // AFTER `bootModules` completes so that every domain service they
  // depend on (messaging, contacts, drive) is already installed. Ordering is
  // enforced by the line sequence below; the old `ModuleDef.requires` edges
  // are gone.
  const channelWeb = createChannelWebTransport({
    db,
    jobs: ports.jobs,
    realtime: ports.realtime,
  })
  app.route(`/api/${channelWeb.name}`, channelWeb.handlers)

  const channelWhatsapp = createChannelWhatsappTransport({
    jobs: ports.jobs,
    realtime: ports.realtime,
  })
  app.route(`/api/${channelWhatsapp.name}`, channelWhatsapp.handlers)

  await wireAuthIntoModules(auth)

  app.route('/api/sse', createSseRoute(ports.realtime))

  // Serve built frontend (Vite outputs to dist/web). In dev the Vite dev
  // server proxies /api here, so this block is a no-op when dist/web is
  // absent — keeps `bun run dev:server` working pre-build.
  const distDir = join(import.meta.dir, '..', 'dist', 'web')
  const indexFile = Bun.file(join(distDir, 'index.html'))
  if (await indexFile.exists()) {
    const indexHtml = await indexFile.text()
    app.use('/assets/*', serveStatic({ root: './dist/web' }))
    app.use('/favicon.ico', serveStatic({ path: './dist/web/favicon.ico' }))
    app.use('/site.webmanifest', serveStatic({ path: './dist/web/site.webmanifest' }))
    // SPA fallback: any non-API GET falls back to index.html so TanStack
    // Router owns client-side paths.
    app.get('*', (c) => c.html(indexHtml))
  }

  // Wake dispatch for the web channel. The pi-agent-core harness reads
  // OPENAI_API_KEY (or BIFROST_API_KEY + BIFROST_URL) from env directly — the
  // handler fails loudly on the first inbound if no key is set.
  const agentContributions = collectAgentContributions(sortedModules)
  jobHandlers.set(
    INBOUND_TO_WAKE_JOB,
    createWakeHandler(
      {
        messaging: ports.messaging,
        contacts: ports.contacts,
        agents: ports.agents,
        drive: ports.drive,
        realtime: ports.realtime,
      },
      agentContributions,
    ),
  )

  return app
}

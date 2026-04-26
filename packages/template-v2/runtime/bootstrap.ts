/**
 * Application orchestration entry point.
 *
 * Constructs the database handle, the in-process job queue, the realtime
 * fanout, the better-auth handle, and the Hono app — then boots every module
 * via core's `bootModules`, wires module-collected jobs, mounts the SSE
 * stream, serves the static frontend, and registers the inbound→wake
 * dispatcher.
 *
 * `main.ts` is a 6-line server entry that imports `createApp(db, sql)` from
 * here and hands the resulting Hono app to `Bun.serve`.
 */

import { join } from 'node:path'
import { createAuth } from '@auth'
import { createRequireSession, createWidgetCors, installOrganizationContext } from '@auth/middleware'
import { createWakeHandler, INBOUND_TO_WAKE_JOB } from '@modules/agents/wake/handler'
import { createHeartbeatEmitter } from '@modules/agents/wake/heartbeat'
import {
  createOperatorThreadWakeHandler,
  OPERATOR_THREAD_TO_WAKE_JOB,
} from '@modules/agents/wake/operator-thread-handler'
import { setHeartbeatEmitter } from '@modules/schedules/service/heartbeat-emitter'
import {
  bootModules,
  collectAgentContributions,
  collectJobs,
  createLogger,
  createRealtimeService,
  type ScheduleOpts,
  setJournalDb,
  sortModules,
} from '@vobase/core'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { logger } from 'hono/logger'
import { streamSSE } from 'hono/streaming'
import { nanoid } from 'nanoid'
import type { Sql } from 'postgres'

import type { RealtimeService, ScopedDb } from './index'
import { modules } from './modules'

// ─── Realtime ───────────────────────────────────────────────────────────────

/**
 * Realtime fanout. Core owns a singleton LISTEN connection + in-memory
 * subscriber fanout. We adapt its signature to v2's `RealtimeService` shape
 * (sync-void `notify`).
 *
 * Neon: `DATABASE_URL` points at the `-pooler` endpoint (PgBouncer, tx mode);
 * pooled sessions cannot deliver NOTIFY to LISTEN. The listener routes via
 * `DATABASE_URL_DIRECT` when set; self-hosted Postgres can leave it unset.
 */
async function buildRealtime(databaseConfig: string, db: ScopedDb): Promise<RealtimeService> {
  const core = await createRealtimeService(
    databaseConfig,
    db as unknown as Parameters<typeof createRealtimeService>[1],
    { listenDsn: process.env.DATABASE_URL_DIRECT },
  )
  return {
    notify(payload, tx) {
      void core
        .notify(payload, tx as unknown as Parameters<typeof core.notify>[1])
        .catch((err) => console.error('[realtime.notify] failed:', err))
    },
    subscribe(fn) {
      return core.subscribe(fn)
    },
  }
}

// ─── In-process job queue ───────────────────────────────────────────────────

interface PendingJob {
  timer: ReturnType<typeof setTimeout> | null
  singletonKey?: string
}

/**
 * In-process job queue satisfying the `ScopedScheduler` contract. Fire-and-
 * forget; swap for pg-boss if/when multi-process or retry-safe delivery
 * becomes necessary.
 *
 * Exported so `jobs.test.ts` can exercise the queue in isolation; runtime
 * consumers reach the queue via `ctx.jobs` inside module `init`.
 */
export function buildJobQueue(handlers: Map<string, (data: unknown) => Promise<void>>) {
  const pending = new Map<string, PendingJob>()
  const bySingleton = new Map<string, string>()

  function dispatch(name: string, data: unknown, jobId: string): void {
    const handler = handlers.get(name)
    if (!handler) {
      console.warn(`[jobs] no handler registered for "${name}"; dropping`)
      pending.delete(jobId)
      return
    }
    console.log(`[jobs] dispatching "${name}" (${jobId})`)
    void handler(data)
      .then(() => console.log(`[jobs] "${name}" (${jobId}) complete`))
      .catch((err) => {
        console.error(`[jobs] handler "${name}" failed:`, err)
      })
      .finally(() => {
        const job = pending.get(jobId)
        if (job?.singletonKey && bySingleton.get(job.singletonKey) === jobId) {
          bySingleton.delete(job.singletonKey)
        }
        pending.delete(jobId)
      })
  }

  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async send(name: string, data: unknown, opts?: ScheduleOpts): Promise<string> {
      const jobId = `job-${nanoid(8)}`
      if (opts?.singletonKey) {
        const existingId = bySingleton.get(opts.singletonKey)
        if (existingId) {
          const existing = pending.get(existingId)
          if (existing?.timer) clearTimeout(existing.timer)
          pending.delete(existingId)
        }
        bySingleton.set(opts.singletonKey, jobId)
      }
      const delay = opts?.startAfter ? Math.max(0, opts.startAfter.getTime() - Date.now()) : 0
      if (delay === 0) {
        pending.set(jobId, { timer: null, singletonKey: opts?.singletonKey })
        dispatch(name, data, jobId)
      } else {
        const timer = setTimeout(() => dispatch(name, data, jobId), delay)
        pending.set(jobId, { timer, singletonKey: opts?.singletonKey })
      }
      return jobId
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async cancel(jobId: string): Promise<void> {
      const job = pending.get(jobId)
      if (!job) return
      if (job.timer) clearTimeout(job.timer)
      if (job.singletonKey && bySingleton.get(job.singletonKey) === jobId) {
        bySingleton.delete(job.singletonKey)
      }
      pending.delete(jobId)
    },
  }
}

// ─── SSE route ──────────────────────────────────────────────────────────────

/**
 * GET /api/sse — fans out from the singleton RealtimeService to each
 * connected browser via Server-Sent Events. Mirrors core's app.ts SSE route.
 * `stream.writeSSE` is fire-and-forget inside the subscriber; awaiting it
 * inside a notify callback serializes writes.
 */
function createSseRoute(realtime: RealtimeService): Hono {
  const app = new Hono()
  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  app.get('/', async (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = realtime.subscribe((payload) => {
        stream.writeSSE({ data: payload, event: 'invalidate' })
      })
      stream.onAbort(unsub)
      await stream.writeSSE({ data: '{}', event: 'connected' })
      while (true) {
        await stream.sleep(25_000)
        await stream.writeSSE({ data: '', event: 'ping' })
      }
    })
  })
  return app
}

// ─── App ────────────────────────────────────────────────────────────────────

export async function createApp(databaseUrl: string, db: ScopedDb, sql: Sql): Promise<Hono> {
  const app = new Hono()
  app.use('*', createWidgetCors())
  app.use('*', logger())
  app.get('/health', (c) => c.json({ ok: true }))

  const auth = createAuth(db)
  installOrganizationContext({ db, auth })
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  const requireSession = createRequireSession(auth)

  // Reserved for future direct-sql infra; kept in signature for call-site stability.
  void sql

  const jobHandlers = new Map<string, (data: unknown) => Promise<void>>()
  const realtime = await buildRealtime(databaseUrl, db)
  const jobs = buildJobQueue(jobHandlers)
  setJournalDb(db)

  // Extended ctx threaded into every module's `init`. `auth` is bootstrap-tier
  // (constructed above before any module init runs) and read from `ctx.auth`
  // by drive's RBAC gate and channel-web's session flow.
  const moduleCtx = { db, organizationId: '', jobs, realtime, auth }
  await bootModules({
    modules,
    app,
    requireSession,
    ctx: moduleCtx,
  })

  // Module-contributed jobs bind here; INBOUND_TO_WAKE_JOB binds separately
  // below as a bootstrap concern (modules don't own the wake dispatcher).
  const sortedModules = sortModules([...modules])
  for (const job of collectJobs(sortedModules)) {
    jobHandlers.set(job.name, job.handler)
  }

  app.route('/api/sse', createSseRoute(realtime))

  // Serve built frontend (Vite outputs to dist/web). In dev the Vite dev
  // server proxies /api here, so this block is a no-op when dist/web is
  // absent — keeps `bun run dev:server` working pre-build.
  const distDir = join(import.meta.dir, 'dist', 'web')
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
  const wakeLogger = createLogger({ format: 'console', prefix: '[wake]', silent: ['debug', 'info'] })
  jobHandlers.set(INBOUND_TO_WAKE_JOB, createWakeHandler({ realtime, db, logger: wakeLogger }, agentContributions))

  // Operator-thread wakes: staff posts a message in `agent_threads`, the
  // chat surface enqueues this job, and the consumer drives an operator
  // wake via `buildOperatorWakeConfig`.
  jobHandlers.set(
    OPERATOR_THREAD_TO_WAKE_JOB,
    createOperatorThreadWakeHandler({ realtime, db, logger: wakeLogger }, agentContributions),
  )

  // Heartbeat wakes: schedules cron-tick fires `HeartbeatTrigger`s into the
  // emitter installed below. Each tick = one operator wake.
  setHeartbeatEmitter(createHeartbeatEmitter({ realtime, db, logger: wakeLogger }, agentContributions))

  return app
}

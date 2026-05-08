/**
 * Bun HTTP server entry point. Run via `bun run dev:server`.
 *
 * idleTimeout: 255s (Bun's max). Without this Bun defaults to ~10s, which
 * kills long-running SSE streams between our 25s keep-alive pings.
 */

// `just-bash`'s sandbox hardening locks `Error.stackTraceLimit` as
// `writable:false, configurable:true` while a bash tool runs. The `postgres`
// driver's `cachedError` (query.js:169) writes `Error.stackTraceLimit = 4`
// on every uncached SQL template — so any DB transaction triggered from a
// bash-tool-dispatched verb throws "Attempted to assign to readonly property".
// Pinning the descriptor as `configurable:false` here makes just-bash's
// `Object.defineProperty` no-op (caught by its own try/catch).
Object.defineProperty(Error, 'stackTraceLimit', {
  value: Error.stackTraceLimit,
  writable: true,
  configurable: false,
  enumerable: true,
})

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { createApp } from './runtime/bootstrap'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase'
const sql = postgres(databaseUrl)
const db = drizzle({ client: sql })
const app = await createApp(databaseUrl, db, sql)
const port = Number(process.env.PORT ?? 3000)

Bun.serve({ fetch: app.fetch, port, idleTimeout: 255 })
console.log(`[server] http://localhost:${port}`)

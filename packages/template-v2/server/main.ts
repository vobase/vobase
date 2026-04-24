/**
 * Bun HTTP server entry point. Run via `bun run dev:server`.
 *
 * Boots the drizzle db, wires module services, starts the Hono app on :3000.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import config from '../vobase.config'
import { createApp } from './app'

const sql = postgres(config.database)
const db = drizzle({ client: sql })

const app = await createApp(db, sql)
const port = Number(process.env.PORT ?? 3000)

// idleTimeout: 255s (Bun's max). Without this Bun defaults to ~10s, which kills
// long-running SSE streams between our 25s keep-alive pings — silently
// unsubscribing the chat page so subsequent notifies go nowhere.
Bun.serve({ fetch: app.fetch, port, idleTimeout: 255 })
console.log(`[server] http://localhost:${port}`)

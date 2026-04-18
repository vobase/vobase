/**
 * Bun HTTP server entry point. Run via `bun run dev:server` or `bun run server/entry.ts`.
 *
 * Boots the drizzle db, wires module services, starts the Hono app on :3000.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import config from '../vobase.config'
import { createApp } from './server'

const sql = postgres(config.database)
const db = drizzle({ client: sql })

const app = createApp(db)
const port = Number(process.env.PORT ?? 3000)

Bun.serve({ fetch: app.fetch, port })
console.log(`[server] http://localhost:${port}`)

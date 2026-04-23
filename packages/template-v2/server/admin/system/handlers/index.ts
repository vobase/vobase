import { auditLog, sequences } from '@vobase/core'
import { desc, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { requireDb } from '../service'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'system', status: 'ok' }))
  .get('/', (c) => {
    const pkg = { version: '0.1.0' }
    return c.json({
      version: pkg.version,
      uptime: process.uptime(),
      modules: ['settings', 'contacts', 'drive', 'messaging', 'agents', 'channel-web', 'channel-whatsapp', 'system'],
    })
  })
  .get('/audit-log', async (c) => {
    const cursor = c.req.query('cursor')
    const limitRaw = Number(c.req.query('limit') ?? '50')
    const limit = Math.min(Math.max(1, Number.isNaN(limitRaw) ? 50 : limitRaw), 200)

    const db = requireDb()

    const rows = await (cursor
      ? db
          .select()
          .from(auditLog)
          .where(lt(auditLog.createdAt, new Date(cursor)))
          .orderBy(desc(auditLog.createdAt))
          .limit(limit + 1)
      : db
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.createdAt))
          .limit(limit + 1))

    const hasMore = rows.length > limit
    const entries = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? (entries[entries.length - 1]?.createdAt?.toISOString() ?? null) : null

    return c.json({ entries, nextCursor })
  })
  .get('/sequences', async (c) => {
    const db = requireDb()
    const entries = await db.select().from(sequences)
    return c.json({ entries })
  })

export default app

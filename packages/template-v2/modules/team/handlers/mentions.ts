/**
 * Team mentions endpoints — T7b.
 *   GET  /mentions/unread          → unread mentions for session user
 *   GET  /mentions/unread/count    → `{ count }` for the nav badge
 *   POST /mentions/:noteId/dismiss → mark one mention read (idempotent)
 *   POST /mentions/dismiss-all     → mark every unread mention read
 */

import type { SessionEnv } from '@auth/middleware/require-session'
import { dismiss, dismissAll, listUnread, unreadCount } from '@modules/team/service/mentions'
import { Hono } from 'hono'

const app = new Hono<SessionEnv>()
  .get('/mentions/unread', async (c) => {
    const userId = c.get('session').user.id
    return c.json(await listUnread(userId))
  })
  .get('/mentions/unread/count', async (c) => {
    const userId = c.get('session').user.id
    return c.json({ count: await unreadCount(userId) })
  })
  .post('/mentions/dismiss-all', async (c) => {
    const userId = c.get('session').user.id
    const dismissed = await dismissAll(userId)
    return c.json({ ok: true, dismissed })
  })
  .post('/mentions/:noteId/dismiss', async (c) => {
    const userId = c.get('session').user.id
    await dismiss(userId, c.req.param('noteId'))
    return c.json({ ok: true })
  })

export default app

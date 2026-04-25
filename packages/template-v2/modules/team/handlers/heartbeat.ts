/**
 * POST /api/team/heartbeat — touches `staff_profiles.last_seen_at` for the
 * current session user. Client pings every 60s while the app is focused.
 * Used by T7b notification fan-out (offline = now() - lastSeenAt > 2min).
 */

import type { SessionEnv } from '@auth/middleware/require-session'
import { find, touchLastSeen } from '@modules/team/service/staff'
import { Hono } from 'hono'

const app = new Hono<SessionEnv>().post('/heartbeat', async (c) => {
  const session = c.get('session')
  const userId = session.user.id
  const profile = await find(userId)
  if (!profile) return c.json({ ok: true, skipped: 'no_profile' })
  await touchLastSeen(userId)
  return c.json({ ok: true, userId, at: new Date().toISOString() })
})

export default app

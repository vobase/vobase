/**
 * POST /api/messaging/conversations/:id/typing
 *
 * Staff-side typing presence — broadcasts an `action: 'typing'` realtime event
 * so the public chat widget can render "{staffName} is typing…". Transient:
 * no persistence, just a `pg_notify` fan-out. The composer calls this on
 * debounced keystrokes (~every 2s while active).
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { notifyTyping } from '@modules/messaging/service/staff-ops'
import { Hono } from 'hono'

const app = new Hono<OrganizationEnv>().use('*', requireOrganization).post('/:id/typing', async (c) => {
  const id = c.req.param('id')
  const user = c.get('session').user
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const userName = (user.name ?? '').trim() || (user.email ?? '').trim() || 'Staff'
  await notifyTyping(id, user.id, userName, 'staff').catch(() => undefined)
  return c.json({ ok: true })
})

export default app

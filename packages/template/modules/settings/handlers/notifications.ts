import type { SessionEnv } from '@auth/middleware/require-session'
import { zValidator } from '@hono/zod-validator'
import { notificationsSchema } from '@modules/settings/pages/schemas/notifications'
import { getPrefs, upsertPrefs } from '@modules/settings/service/notification-prefs'
import { type PingKind, sendTestNotification } from '@modules/team/service/staff-ping'
import { Hono } from 'hono'
import { z } from 'zod'

/** A `decision` toggle covers both approvals and proposals — they share a template. */
const testNotificationSchema = z.object({ kind: z.enum(['mention', 'decision', 'admin_alert']) })

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

const app = new Hono<SessionEnv>()
  .get('/notifications', async (c) => {
    const userId = c.get('session').user.id
    const prefs = await getPrefs(userId)
    return c.json({ matrix: prefs.prefs, notifyWhileOnline: prefs.notifyWhileOnline })
  })
  .post('/notifications', zValidator('json', notificationsSchema, invalidBody), async (c) => {
    const userId = c.get('session').user.id
    const { matrix, notifyWhileOnline } = c.req.valid('json')
    const prefs = await upsertPrefs(userId, matrix, notifyWhileOnline)
    return c.json({ matrix: prefs.prefs, notifyWhileOnline: prefs.notifyWhileOnline })
  })
  // Dev-only: fire a test WhatsApp notification to the signed-in user's own phone.
  .post('/notifications/test', zValidator('json', testNotificationSchema, invalidBody), async (c) => {
    if (process.env.NODE_ENV === 'production') return c.json({ error: 'not_available' }, 403)
    const session = c.get('session')
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) return c.json({ error: 'no_active_organization' }, 400)
    const { kind } = c.req.valid('json')
    const pingKind: PingKind = kind === 'decision' ? 'approval' : kind
    const result = await sendTestNotification(pingKind, session.user.id, organizationId)
    return c.json(result)
  })

export default app

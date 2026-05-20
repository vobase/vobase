import type { SessionEnv } from '@auth/middleware/require-session'
import { zValidator } from '@hono/zod-validator'
import { notificationsSchema } from '@modules/settings/pages/schemas/notifications'
import { getPrefs, upsertPrefs } from '@modules/settings/service/notification-prefs'
import { Hono } from 'hono'

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

export default app

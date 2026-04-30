import type { SessionEnv } from '@auth/middleware/require-session'
import { zValidator } from '@hono/zod-validator'
import { getPrefs, upsertPrefs } from '@modules/settings/service/notification-prefs'
import { Hono } from 'hono'
import { z } from 'zod'

const notificationsSchema = z.object({
  mentionsEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
})

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

const app = new Hono<SessionEnv>()
  .get('/notifications', async (c) => {
    const userId = c.get('session').user.id
    return c.json(await getPrefs(userId))
  })
  .post('/notifications', zValidator('json', notificationsSchema, invalidBody), async (c) => {
    const userId = c.get('session').user.id
    return c.json(await upsertPrefs(userId, c.req.valid('json')))
  })

export default app

import { getPrefs, upsertPrefs } from '@modules/settings/service/notification-prefs'
import type { SessionEnv } from '@server/middlewares/require-session'
import { Hono } from 'hono'
import { z } from 'zod'

const notificationsSchema = z.object({
  mentionsEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
})

const app = new Hono<SessionEnv>()
  .get('/notifications', async (c) => {
    const userId = c.get('session').user.id
    return c.json(await getPrefs(userId))
  })
  .post('/notifications', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = notificationsSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const userId = c.get('session').user.id
    return c.json(await upsertPrefs(userId, parsed.data))
  })

export default app

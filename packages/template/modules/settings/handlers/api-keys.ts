import type { SessionEnv } from '@auth/middleware/require-session'
import { zValidator } from '@hono/zod-validator'
import { createKey, listKeys, revokeKey } from '@modules/settings/service/api-keys'
import { Hono } from 'hono'
import { z } from 'zod'

const createSchema = z.object({ name: z.string().min(1) })

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

const app = new Hono<SessionEnv>()
  .get('/api-keys', async (c) => {
    const userId = c.get('session').user.id
    return c.json(await listKeys(userId))
  })
  .post('/api-keys', zValidator('json', createSchema, invalidBody), async (c) => {
    const userId = c.get('session').user.id
    const { name } = c.req.valid('json')
    return c.json(await createKey(userId, name))
  })
  .delete('/api-keys/:id', async (c) => {
    const userId = c.get('session').user.id
    const ok = await revokeKey(userId, c.req.param('id'))
    if (!ok) return c.json({ error: 'not_found' }, 404)
    return c.json({ ok: true })
  })

export default app

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import apiKeysHandlers from './api-keys'
import notificationsHandlers from './notifications'

const profileSchema = z.object({
  displayName: z.string().optional(),
  email: z.string().email().optional(),
})

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

const ok = (c: { json: (b: unknown) => Response }) => c.json({ ok: true })

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'settings', status: 'ok' }))
  .route('/', notificationsHandlers)
  .route('/', apiKeysHandlers)
  .post('/profile', zValidator('json', profileSchema, invalidBody), (c) => ok(c))

export default app

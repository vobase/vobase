import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import notificationsHandlers from './notifications'

const profileSchema = z.object({
  displayName: z.string().optional(),
  email: z.string().email().optional(),
})

const appearanceSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  fontSize: z.enum(['sm', 'md', 'lg']).optional(),
})

const displaySchema = z.object({
  density: z.enum(['comfortable', 'compact']).optional(),
  showAvatars: z.boolean().optional(),
})

const apiKeysSchema = z.object({
  name: z.string().min(1),
  scope: z.string().optional(),
})

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

const ok = (c: { json: (b: unknown) => Response }) => c.json({ ok: true })

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'settings', status: 'ok' }))
  .route('/', notificationsHandlers)
  .post('/profile', zValidator('json', profileSchema, invalidBody), (c) => ok(c))
  .post('/appearance', zValidator('json', appearanceSchema, invalidBody), (c) => ok(c))
  .post('/display', zValidator('json', displaySchema, invalidBody), (c) => ok(c))
  .post('/api-keys', zValidator('json', apiKeysSchema, invalidBody), (c) => ok(c))

export default app

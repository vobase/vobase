import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'

const app = new Hono()

app.get('/health', (c) => c.json({ module: 'settings', status: 'ok' }))

// ── Schemas ───────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  displayName: z.string().optional(),
  email: z.string().email().optional(),
})

const accountSchema = z.object({
  timezone: z.string().optional(),
  language: z.string().optional(),
})

const appearanceSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  fontSize: z.enum(['sm', 'md', 'lg']).optional(),
})

const notificationsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
})

const displaySchema = z.object({
  density: z.enum(['comfortable', 'compact']).optional(),
  showAvatars: z.boolean().optional(),
})

const apiKeysSchema = z.object({
  name: z.string().min(1),
  scope: z.string().optional(),
})

// ── Handler factory ───────────────────────────────────────────────────────────

async function stubPost(c: Context, schema: z.ZodTypeAny) {
  const raw = await c.req.json().catch(() => null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
  }
  return c.json({ ok: true })
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/profile', (c) => stubPost(c, profileSchema))
app.post('/account', (c) => stubPost(c, accountSchema))
app.post('/appearance', (c) => stubPost(c, appearanceSchema))
app.post('/notifications', (c) => stubPost(c, notificationsSchema))
app.post('/display', (c) => stubPost(c, displaySchema))
app.post('/api-keys', (c) => stubPost(c, apiKeysSchema))

export default app

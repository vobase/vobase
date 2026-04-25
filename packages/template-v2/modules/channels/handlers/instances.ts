/**
 * Generic CRUD for channel instances.
 *
 * Adapter-agnostic: `config` is opaque JSONB. Each adapter's
 * `adapters/<name>/config.ts` Zod schema validates the payload before it lands
 * here — the frontend layer is responsible for picking the right schema by
 * channel name.
 */

import { zValidator } from '@hono/zod-validator'
import {
  createInstance,
  getInstance,
  listInstances,
  removeInstance,
  updateInstance,
} from '@modules/channels/service/instances'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const createBody = z.object({
  channel: z.string().min(1).max(64),
  role: z.enum(['customer', 'staff']).optional(),
  displayName: z.string().min(1).max(120).nullable(),
  config: z.record(z.string(), z.unknown()).default({}),
  webhookSecret: z.string().min(1).nullable().optional(),
})

const updateBody = z.object({
  displayName: z.string().min(1).max(120).nullable().optional(),
  /** Replaces the whole `config` blob if present. */
  config: z.record(z.string(), z.unknown()).optional(),
  /** Shallow-merged into the existing `config` (server-side). */
  configPatch: z.record(z.string(), z.unknown()).optional(),
  webhookSecret: z.string().min(1).nullable().optional(),
  status: z.string().min(1).nullable().optional(),
  setupStage: z.string().min(1).nullable().optional(),
  lastError: z.string().nullable().optional(),
})

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

/** Shallow merge: undefined keeps existing, null deletes the key, otherwise overwrites. */
function mergeConfig(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...existing }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k]
    else if (v !== undefined) next[k] = v
  }
  return next
}

const app = new Hono()
  .get('/', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const channel = c.req.query('channel') ?? undefined
    const rows = await listInstances(organizationId, channel)
    return c.json(rows)
  })
  .get('/:id', async (c) => {
    const id = c.req.param('id')
    const row = await getInstance(id)
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json(row)
  })
  .post('/', zValidator('json', createBody, invalidBody), async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const data = c.req.valid('json')
    const row = await createInstance({
      organizationId,
      channel: data.channel,
      role: data.role,
      displayName: data.displayName,
      config: data.config,
      webhookSecret: data.webhookSecret ?? null,
    })
    return c.json(row, 201)
  })
  .patch('/:id', zValidator('json', updateBody, invalidBody), async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const id = c.req.param('id')
    const data = c.req.valid('json')
    let nextConfig = data.config
    if (data.configPatch) {
      const existing = await getInstance(id)
      if (!existing) return c.json({ error: 'not_found' }, 404)
      nextConfig = mergeConfig(existing.config, data.configPatch)
    }
    try {
      const row = await updateInstance(id, organizationId, {
        displayName: data.displayName,
        config: nextConfig,
        webhookSecret: data.webhookSecret,
        status: data.status,
        setupStage: data.setupStage,
        lastError: data.lastError,
      })
      return c.json(row)
    } catch (err) {
      // Service throws this exact message when the row isn't found in the
      // org-scoped query. Anything else is an unexpected DB error — let it bubble.
      if (err instanceof Error && err.message === 'channels/instances: row not found') {
        return c.json({ error: 'not_found' }, 404)
      }
      throw err
    }
  })
  .delete('/:id', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const id = c.req.param('id')
    await removeInstance(id, organizationId)
    return c.json({ ok: true })
  })

export default app

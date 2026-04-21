/**
 * Attribute-definitions HTTP handlers.
 *
 * Routes:
 *   GET    /definitions                         list defs
 *   POST   /definitions                         create def
 *   PATCH  /definitions/:id                     update def
 *   DELETE /definitions/:id                     delete def
 *   PATCH  /:contactId/attributes               merge contact attribute values
 */

import {
  createDef,
  listDefs,
  removeDef,
  setContactAttributeValues,
  updateDef,
} from '@modules/contacts/service/attribute-definitions'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const typeSchema = z.enum(['text', 'number', 'boolean', 'date', 'enum'])

const createDefBody = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'lowercase snake_case'),
  label: z.string().min(1).max(120),
  type: typeSchema,
  options: z.array(z.string().min(1)).optional(),
  showInTable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

const updateDefBody = z.object({
  label: z.string().min(1).max(120).optional(),
  type: typeSchema.optional(),
  options: z.array(z.string().min(1)).optional(),
  showInTable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const patchContactBody = z.object({
  values: z.record(z.string().min(1), valueSchema),
})

const app = new Hono()
  .get('/definitions', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const rows = await listDefs(organizationId)
    return c.json(rows)
  })
  .post('/definitions', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = createDefBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    if (parsed.data.type === 'enum' && (!parsed.data.options || parsed.data.options.length === 0)) {
      return c.json({ error: 'enum_requires_options' }, 400)
    }
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const row = await createDef({ organizationId, ...parsed.data })
    return c.json(row)
  })
  .patch('/definitions/:id', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = updateDefBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const row = await updateDef(c.req.param('id'), parsed.data)
    return c.json(row)
  })
  .delete('/definitions/:id', async (c) => {
    await removeDef(c.req.param('id'))
    return c.json({ ok: true, id: c.req.param('id') })
  })
  .patch('/:contactId/attributes', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = patchContactBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const row = await setContactAttributeValues(c.req.param('contactId'), parsed.data.values)
    return c.json(row)
  })

export default app

/**
 * Staff attribute-definitions HTTP handlers.
 *
 * Routes:
 *   GET    /attributes                            list defs
 *   POST   /attributes                            create def
 *   PATCH  /attributes/:id                        update def
 *   DELETE /attributes/:id                        delete def
 *   PATCH  /staff/:userId/attributes              merge staff attribute values
 */

import { zValidator } from '@hono/zod-validator'
import { createDef, listDefs, removeDef, updateDef } from '@modules/team/service/attribute-definitions'
import { setAttributes as setStaffAttributeValues } from '@modules/team/service/staff'
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
const patchStaffBody = z.object({
  values: z.record(z.string().min(1), valueSchema),
})

const app = new Hono()
  .get('/attributes', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const rows = await listDefs(organizationId)
    return c.json(rows)
  })
  .post(
    '/attributes',
    zValidator('json', createDefBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      if (data.type === 'enum' && (!data.options || data.options.length === 0)) {
        return c.json({ error: 'enum_requires_options' }, 400)
      }
      const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
      const row = await createDef({ organizationId, ...data })
      return c.json(row)
    },
  )
  .patch(
    '/attributes/:id',
    zValidator('json', updateDefBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const row = await updateDef(c.req.param('id'), data)
      return c.json(row)
    },
  )
  .delete('/attributes/:id', async (c) => {
    await removeDef(c.req.param('id'))
    return c.json({ ok: true, id: c.req.param('id') })
  })
  .patch(
    '/staff/:userId/attributes',
    zValidator('json', patchStaffBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const row = await setStaffAttributeValues(c.req.param('userId'), data.values)
      return c.json(row)
    },
  )

export default app

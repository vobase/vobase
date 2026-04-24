import {
  create as createContact,
  get as getContact,
  list as listContacts,
  update as updateContact,
} from '@modules/contacts/service/contacts'
import { Hono } from 'hono'
import { z } from 'zod'

import attributeHandlers from './attributes'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const createContactBody = z.object({
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().min(1).max(40).nullable().optional(),
  segments: z.array(z.string().min(1)).optional(),
  marketingOptOut: z.boolean().optional(),
})

const updateContactBody = createContactBody

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'contacts', status: 'ok' }))
  .route('/', attributeHandlers)
  .get('/', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const rows = await listContacts(organizationId)
    return c.json(rows)
  })
  .post('/', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = createContactBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const row = await createContact({ organizationId, ...parsed.data })
    return c.json(row)
  })
  .get('/:id', async (c) => {
    try {
      const row = await getContact(c.req.param('id'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .patch('/:id', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = updateContactBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    try {
      const row = await updateContact(c.req.param('id'), parsed.data)
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })

export default app

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import {
  create as createContact,
  get as getContact,
  list as listContacts,
  update as updateContact,
} from '@modules/contacts/service/contacts'
import { Hono } from 'hono'
import { z } from 'zod'

import agentViewHandler from './agent-view'
import attributeHandlers from './attributes'

const createContactBody = z.object({
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().min(1).max(40).nullable().optional(),
  segments: z.array(z.string().min(1)).optional(),
  marketingOptOut: z.boolean().optional(),
})

const updateContactBody = createContactBody

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/health', (c) => c.json({ module: 'contacts', status: 'ok' }))
  .route('/', attributeHandlers)
  .route('/', agentViewHandler)
  .get('/', async (c) => {
    const rows = await listContacts(c.get('organizationId'))
    return c.json(rows)
  })
  .post(
    '/',
    zValidator('json', createContactBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const row = await createContact({ organizationId: c.get('organizationId'), ...data })
      return c.json(row)
    },
  )
  .get('/:id', async (c) => {
    try {
      const row = await getContact(c.req.param('id'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .patch(
    '/:id',
    zValidator('json', updateContactBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      try {
        const row = await updateContact(c.req.param('id'), data)
        return c.json(row)
      } catch {
        return c.json({ error: 'not_found' }, 404)
      }
    },
  )

export default app

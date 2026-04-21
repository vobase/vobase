import { get as getContact, list as listContacts } from '@modules/contacts/service/contacts'
import { Hono } from 'hono'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'contacts', status: 'ok' }))
  .get('/', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const rows = await listContacts(organizationId)
    return c.json(rows)
  })
  .get('/:id', async (c) => {
    try {
      const row = await getContact(c.req.param('id'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })

export default app

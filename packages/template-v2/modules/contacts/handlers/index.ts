import { get as getContact, list as listContacts } from '@modules/contacts/service/contacts'
import { Hono } from 'hono'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const app = new Hono()

app.get('/health', (c) => c.json({ module: 'contacts', status: 'ok' }))

app.get('/', async (c) => {
  const tenantId = c.req.query('tenantId') ?? DEFAULT_TENANT
  const rows = await listContacts(tenantId)
  return c.json(rows)
})

app.get('/:id', async (c) => {
  try {
    const row = await getContact(c.req.param('id'))
    return c.json(row)
  } catch {
    return c.json({ error: 'not_found' }, 404)
  }
})

export default app

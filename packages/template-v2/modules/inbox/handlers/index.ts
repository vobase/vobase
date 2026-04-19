import { list as listConversations } from '@modules/inbox/service/conversations'
import { list as listMessages } from '@modules/inbox/service/messages'
import { list as listApprovals } from '@modules/inbox/service/pending-approvals'
import { Hono } from 'hono'
import approvals from './approvals'
import notes from './notes'
import reassign from './reassign'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const app = new Hono()

app.get('/health', (c) => c.json({ module: 'inbox', status: 'ok' }))

app.get('/conversations', async (c) => {
  const tenantId = c.req.query('tenantId') ?? DEFAULT_TENANT
  const status = c.req.query('status')?.split(',').filter(Boolean)
  const rows = await listConversations(tenantId, status?.length ? { status } : undefined)
  return c.json(rows)
})

app.get('/conversations/:id/messages', async (c) => {
  const id = c.req.param('id')
  const limit = Number(c.req.query('limit') ?? 50)
  const rows = await listMessages(id, { limit })
  return c.json(rows)
})

app.get('/approvals', async (c) => {
  const tenantId = c.req.query('tenantId') ?? DEFAULT_TENANT
  const status = c.req.query('status') ?? 'pending'
  const rows = await listApprovals(tenantId, { status })
  return c.json(rows)
})

// Plan §P2.4 A2: /api/inbox/approvals/* is owned by Lane D; handler file lives here.
app.route('/approvals', approvals)

// Parcel SV: staff endpoints — /conversations/:id/notes and /conversations/:id/reassign
app.route('/conversations', notes)
app.route('/conversations', reassign)

export default app

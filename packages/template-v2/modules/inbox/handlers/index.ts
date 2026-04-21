import { get as getConversation, list as listConversations } from '@modules/inbox/service/conversations'
import { list as listMessages } from '@modules/inbox/service/messages'
import { list as listApprovals } from '@modules/inbox/service/pending-approvals'
import { Hono } from 'hono'
import approvals from './approvals'
import notes from './notes'
import reassign from './reassign'
import reply from './reply'
import resolve from './resolve'
import snooze from './snooze'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'inbox', status: 'ok' }))
  .get('/conversations', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const status = c.req.query('status')?.split(',').filter(Boolean)
    const tabRaw = c.req.query('tab')
    const tab = tabRaw === 'active' || tabRaw === 'later' || tabRaw === 'done' ? tabRaw : undefined
    const owner = c.req.query('owner') || undefined
    const rows = await listConversations(organizationId, {
      status: status?.length ? status : undefined,
      tab,
      owner,
    })
    return c.json(rows)
  })
  .get('/conversations/:id', async (c) => {
    try {
      const row = await getConversation(c.req.param('id'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .get('/conversations/:id/messages', async (c) => {
    const id = c.req.param('id')
    const limit = Number(c.req.query('limit') ?? 50)
    const rows = await listMessages(id, { limit })
    return c.json(rows)
  })
  .get('/approvals', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const status = c.req.query('status') ?? 'pending'
    const rows = await listApprovals(organizationId, { status })
    return c.json(rows)
  })
  .route('/approvals', approvals)
  .route('/conversations', notes)
  .route('/conversations', reassign)
  .route('/conversations', reply)
  .route('/conversations', snooze)
  .route('/conversations', resolve)

export default app

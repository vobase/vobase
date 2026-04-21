import { Hono } from 'hono'
import proposalHandlers from './proposal'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'drive', status: 'ok' }))
  .route('/proposals', proposalHandlers)

export default app

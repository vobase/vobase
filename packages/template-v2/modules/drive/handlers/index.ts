import { Hono } from 'hono'
import filesHandlers from './files'
import proposalHandlers from './proposal'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'drive', status: 'ok' }))
  .route('/proposals', proposalHandlers)
  .route('/', filesHandlers)

export default app

import { Hono } from 'hono'

import agentViewHandler from './agent-view'
import definitionsHandler from './definitions'
import memoryHandler from './memory'
import threadsHandler from './threads'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'agents', status: 'ok' }))
  .route('/', definitionsHandler)
  .route('/', agentViewHandler)
  .route('/', threadsHandler)
  .route('/conversations', memoryHandler)

export default app

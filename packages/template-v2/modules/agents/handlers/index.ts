import { Hono } from 'hono'

import definitionsHandler from './definitions'
import memoryHandler from './memory'
import threadsHandler from './threads'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'agents', status: 'ok' }))
  .route('/', definitionsHandler)
  .route('/', threadsHandler)
  .route('/conversations', memoryHandler)

export default app

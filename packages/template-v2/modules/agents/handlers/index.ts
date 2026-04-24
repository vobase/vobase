import { Hono } from 'hono'

import definitionsHandler from './definitions'
import learningsHandler from './learnings'
import memoryHandler from './memory'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'agents', status: 'ok' }))
  .route('/', learningsHandler)
  .route('/', definitionsHandler)
  .route('/conversations', memoryHandler)

export default app

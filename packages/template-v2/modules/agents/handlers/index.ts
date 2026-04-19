import { Hono } from 'hono'
import learningsHandler from './learnings'
import memoryHandler from './memory'

const app = new Hono()

app.get('/health', (c) => c.json({ module: 'agents', status: 'ok' }))
app.route('/', learningsHandler)
app.route('/conversations', memoryHandler)

export default app

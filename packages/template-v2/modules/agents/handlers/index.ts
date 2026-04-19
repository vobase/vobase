import { Hono } from 'hono'
import learningsHandler from './learnings'

const app = new Hono()

app.get('/health', (c) => c.json({ module: 'agents', status: 'ok' }))
app.route('/', learningsHandler)

export default app

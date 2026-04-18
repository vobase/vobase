import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) => c.json({ module: 'agents', status: 'ok' }))

export default app

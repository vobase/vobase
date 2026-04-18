import { Hono } from 'hono'
import { handleInbound } from './inbound'
import { handleOutbound } from './outbound'

const app = new Hono()

app.get('/health', (c) => c.json({ module: 'channel-web', status: 'ok' }))
app.post('/inbound', handleInbound)
app.post('/outbound', handleOutbound)

export default app

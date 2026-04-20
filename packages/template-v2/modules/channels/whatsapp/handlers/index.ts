import { Hono } from 'hono'
import { handleWebhookEvent } from './webhook-event'
import { handleWebhookVerify } from './webhook-verify'

const app = new Hono()

app.get('/health', (c) => c.json({ module: 'channel-whatsapp', status: 'ok' }))
app.get('/webhook', handleWebhookVerify)
app.post('/webhook', handleWebhookEvent)

export default app

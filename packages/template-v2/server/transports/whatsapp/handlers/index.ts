import { Hono } from 'hono'

import { handleWebhookEvent } from './webhook-event'
import { handleWebhookVerify } from './webhook-verify'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'channel-whatsapp', status: 'ok' }))
  .get('/webhook', handleWebhookVerify)
  .post('/webhook', handleWebhookEvent)

export default app

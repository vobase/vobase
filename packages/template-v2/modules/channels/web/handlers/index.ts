import { Hono } from 'hono'
import { handleCardReply } from './card-reply'
import { handleInbound } from './inbound'
import { handleOutbound } from './outbound'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'channel-web', status: 'ok' }))
  .post('/inbound', handleInbound)
  .post('/outbound', handleOutbound)
  .post('/card-reply', handleCardReply)

export default app

import { Hono } from 'hono'
import { handleAnonymousSession } from './anonymous-session'
import { handleCardReply } from './card-reply'
import { handleInbound } from './inbound'
import instances from './instances'
import { handleOutbound } from './outbound'

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'channel-web', status: 'ok' }))
  .post('/anonymous-session', handleAnonymousSession)
  .post('/inbound', handleInbound)
  .post('/outbound', handleOutbound)
  .post('/card-reply', handleCardReply)
  .route('/instances', instances)

export default app

/**
 * Web channel adapter routes — mounted under `/api/channels/adapters/web`.
 *
 * Anonymous-session, session-authed inbound, in-app card replies, and the
 * public chat-link metadata route. All cross-channel concerns (instance CRUD,
 * webhook ingress, outbound dispatch) live in the umbrella's
 * `modules/channels/handlers/`.
 */

import { Hono } from 'hono'

import { handleAnonymousSession } from './anonymous-session'
import { handleCardReply } from './card-reply'
import { handleInbound } from './inbound'
import instances from './instances'

const app = new Hono()
  .post('/anonymous-session', handleAnonymousSession)
  .post('/inbound', handleInbound)
  .post('/card-reply', handleCardReply)
  .route('/instances', instances)

export default app

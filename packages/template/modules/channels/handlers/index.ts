/**
 * Channels umbrella router. Mounted at `/api/channels`.
 *
 * Layout:
 *   - /instances       → generic CRUD on `channel_instances` (session-required)
 *   - /webhook/:c/:i   → generic provider-webhook ingress (PUBLIC, HMAC-gated)
 *   - /adapters/web    → web-specific routes (PUBLIC, anonymous-session)
 *
 * Auth split: `/instances` is admin and must run behind the same `requireSession`
 * gate every other admin module uses. `/webhook` and `/adapters/web` must stay
 * unauthenticated — providers and anonymous browser sessions can't carry a staff
 * cookie. A module-level `requireSession: true` flag would gate everything, so
 * we apply it inline on `/instances/*` only via a lazy proxy that pulls the
 * middleware from channels state (installed during `init` from `ctx.auth`).
 *
 * Outbound dispatch is in-process via `service/outbound.sendOutbound()`,
 * called by tools (`reply`, `send_card`, `send_file`) and `sendStaffReply`
 * after they persist their message rows. No HTTP surface.
 */

import { Hono, type MiddlewareHandler } from 'hono'

import webAdapter from '../adapters/web/handlers'
import managedWhatsapp from '../adapters/whatsapp/handlers/managed'
import { getRequireSession } from '../service/state'
import inboundRouter from './inbound-router'
import instances from './instances'
import webhook from './webhook'
import whatsappSignup from './whatsapp-signup'

// biome-ignore lint/suspicious/useAwait: Hono MiddlewareHandler contract requires async signature
const lazyRequireSession: MiddlewareHandler = async (c, next) => {
  const mw = getRequireSession()
  if (!mw) return c.json({ error: 'auth not initialised' }, 503)
  return mw(c, next)
}

const app = new Hono()
  .use('/instances/*', lazyRequireSession)
  .use('/whatsapp/managed/*', lazyRequireSession)
  .use('/whatsapp/signup/*', lazyRequireSession)
  .route('/instances', instances)
  .route('/webhook', webhook)
  .route('/adapters/web', webAdapter)
  .route('/whatsapp', managedWhatsapp)
  .route('/whatsapp/signup', whatsappSignup)
  // Registry-driven managed-channel inbound (notification tier + future
  // kinds). Public — verified inline via the v2 HMAC transport.
  .route('/managed', inboundRouter)

export default app

/**
 * Channels umbrella router. Mounted at `/api/channels`.
 *
 * Layout:
 *   - /instances       → generic CRUD on `channel_instances` (session-required)
 *   - /webhooks/:c/:i  → generic provider-webhook ingress (PUBLIC, HMAC-gated)
 *   - /adapters/web    → web-specific routes (PUBLIC, anonymous-session)
 *
 * Auth split: `/instances` is admin and must run behind the same `requireSession`
 * gate every other admin module uses. `/webhooks` and `/adapters/web` must stay
 * unauthenticated — providers and anonymous browser sessions can't carry a staff
 * cookie. A module-level `requireSession: true` flag would gate everything, so
 * we apply it inline on `/instances/*` only via a lazy proxy that pulls the
 * middleware from channels state (installed during `init` from `ctx.auth`).
 *
 * Outbound dispatch is in-process via `service/outbound.dispatchOutbound()` —
 * no HTTP surface, since the only caller is the wake worker.
 */

import { Hono, type MiddlewareHandler } from 'hono'

import webAdapter from '../adapters/web/handlers'
import managedWhatsapp from '../adapters/whatsapp/handlers/managed'
import { getRequireSession } from '../service/state'
import instances from './instances'
import webhook from './webhook'
import whatsappSignup from './whatsapp-signup'

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
  .route('/webhooks', webhook)
  .route('/adapters/web', webAdapter)
  .route('/whatsapp', managedWhatsapp)
  .route('/whatsapp/signup', whatsappSignup)

export default app

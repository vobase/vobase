/**
 * Channels umbrella router. Mounted at `/api/channels`.
 *
 * Layout:
 *   - /instances       → generic CRUD on `channel_instances`
 *   - /webhooks/:c/:i  → generic provider-webhook ingress
 *   - /adapters/web    → web-specific routes (anonymous-session, inbound, card-reply, public)
 *
 * Outbound dispatch is in-process via `service/outbound.dispatchOutbound()` —
 * no HTTP surface, since the only caller is the wake worker.
 */

import { Hono } from 'hono'

import webAdapter from '../adapters/web/handlers'
import instances from './instances'
import webhook from './webhook'

const app = new Hono().route('/instances', instances).route('/webhooks', webhook).route('/adapters/web', webAdapter)

export default app

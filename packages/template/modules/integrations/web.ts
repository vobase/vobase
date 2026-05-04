/**
 * `integrations` module — `/api/integrations/*` route surface.
 *
 * Mounts:
 *   POST /vobase-platform/handshake     (requireOrganization, ADMIN)
 *   POST /vobase-platform/token/update  (HMAC-verified, no session)
 */

import { Hono } from 'hono'

import handshake from './handlers/managed-handshake'
import tokenUpdate from './handlers/token-update'

const app = new Hono().route('/', handshake).route('/', tokenUpdate)

export const routes = {
  basePath: '/api/integrations',
  handler: app,
}

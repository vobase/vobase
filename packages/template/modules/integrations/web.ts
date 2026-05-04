/**
 * `integrations` module — `/api/integrations/*` route surface.
 *
 * Mounts:
 *   POST /vobase-platform/token/update  (HMAC-verified, no session)
 */

import { Hono } from 'hono'

import tokenUpdate from './handlers/token-update'

const app = new Hono().route('/', tokenUpdate)

export const routes = {
  basePath: '/api/integrations',
  handler: app,
}

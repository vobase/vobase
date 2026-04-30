/**
 * Web routes for the agents module. Re-exported so `server/app.ts` can mount
 * via `collectWebRoutes(modules)` without importing `./handlers` directly.
 */

import handlers from './handlers'

export const routes = { basePath: '/api/agents', handler: handlers, requireSession: true }

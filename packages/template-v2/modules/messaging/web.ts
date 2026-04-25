/**
 * Web routes for the messaging module. Re-exports the handlers barrel so
 * `server/app.ts` can mount via `collectWebRoutes(modules)` without importing
 * `./handlers` directly.
 */

import handlers from './handlers'

export const routes = { basePath: '/api/messaging', handler: handlers, requireSession: true }

import handlers from './handlers'

export const routes = { basePath: '/api/team', handler: handlers, requireSession: true }

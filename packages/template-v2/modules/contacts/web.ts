import handlers from './handlers'

export const routes = { basePath: '/api/contacts', handler: handlers, requireSession: true }

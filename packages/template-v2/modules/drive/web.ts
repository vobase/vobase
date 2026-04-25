import handlers from './handlers'

export const routes = { basePath: '/api/drive', handler: handlers, requireSession: true }

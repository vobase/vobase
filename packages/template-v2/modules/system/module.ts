import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { setDb as setSystemDb } from './service'

export default defineModule({
  name: 'system',
  version: '1.0',
  requires: [],
  manifest,
  routes: { basePath: '/api/system', handler: handlers, requireSession: true },
  init(ctx) {
    setSystemDb(ctx.db)
  },
})

import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'

export default defineModule({
  name: 'settings',
  version: '1.0',
  requires: [],
  manifest,
  routes: { basePath: '/api/settings', handler: handlers, requireSession: true },
  init(_ctx) {
    // stub — no services to wire in Phase 1
  },
})

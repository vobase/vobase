import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { createSystemService, installSystemService } from './service'

export default defineModule({
  name: 'system',
  version: '1.0',
  requires: [],
  manifest: {
    provides: {
      commands: ['system:info', 'system:health', 'system:audit-log', 'system:sequences'],
    },
    permissions: [],
    workspace: { owns: [] },
  },
  routes: { basePath: '/api/system', handler: handlers, requireSession: true },
  init(ctx) {
    installSystemService(createSystemService({ db: ctx.db }))
  },
})

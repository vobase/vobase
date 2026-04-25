import type { ModuleDef } from '@server/common/module-def'

import handlers from './handlers'
import { createSystemService, installSystemService } from './service'

const system: ModuleDef = {
  name: 'system',
  requires: [],
  web: { routes: { basePath: '/api/system', handler: handlers, requireSession: true } },
  jobs: [],
  init(ctx) {
    installSystemService(createSystemService({ db: ctx.db }))
  },
}

export default system

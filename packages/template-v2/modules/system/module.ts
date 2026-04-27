import type { ModuleDef } from '~/runtime'
import { setResourcesDb, systemVerbs } from './cli'
import handlers from './handlers'
import { createSystemService, installSystemService } from './service'

const system: ModuleDef = {
  name: 'system',
  requires: [],
  web: { routes: { basePath: '/api/system', handler: handlers, requireSession: true } },
  jobs: [],
  init(ctx) {
    installSystemService(createSystemService({ db: ctx.db }))
    setResourcesDb(ctx.db)
    ctx.cli.registerAll(systemVerbs)
  },
}

export default system

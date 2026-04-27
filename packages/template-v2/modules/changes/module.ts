import type { ModuleDef } from '~/runtime'
import handlers from './handlers'
import { createChangeProposalsService, installChangeProposalsService } from './service/proposals'

const changes: ModuleDef = {
  name: 'changes',
  requires: ['messaging', 'agents'],
  web: { routes: { basePath: '/api/changes', handler: handlers } },
  jobs: [],
  init(ctx) {
    installChangeProposalsService(createChangeProposalsService({ db: ctx.db, realtime: ctx.realtime }))
  },
}

export default changes

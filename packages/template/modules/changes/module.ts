import type { ModuleDef } from '~/runtime'
import handlers from './handlers'
import { createChangeProposalsService, installChangeProposalsService } from './service/proposals'

const changes: ModuleDef = {
  name: 'changes',
  // `messaging` only — `agents` is a type-only import (`AgentEvent`) and would
  // form a cycle since `agents` requires `changes` to register its materializers.
  requires: ['messaging'],
  web: { routes: { basePath: '/api/changes', handler: handlers, requireSession: true } },
  jobs: [],
  init(ctx) {
    installChangeProposalsService(createChangeProposalsService({ db: ctx.db, realtime: ctx.realtime }))
  },
}

export default changes

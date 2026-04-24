import type { ModuleDef } from '@server/common/module-def'

import handlers from './handlers'
import { setFilesDb } from './service/files'
import { createProposalService, installProposalService } from './service/proposal'

const drive: ModuleDef = {
  name: 'drive',
  routes: { basePath: '/api/drive', handler: handlers, requireSession: true },
  init(ctx) {
    setFilesDb(ctx.db)
    installProposalService(createProposalService({ organizationId: ctx.organizationId }))
  },
}

export default drive

import type { ModuleDef } from '@server/common/module-def'

import { setFilesDb } from './service/files'
import { createProposalService, installProposalService } from './service/proposal'
import * as web from './web'

const drive: ModuleDef = {
  name: 'drive',
  web: { routes: web.routes },
  jobs: [],
  init(ctx) {
    setFilesDb(ctx.db)
    installProposalService(createProposalService({ organizationId: ctx.organizationId }))
  },
}

export default drive

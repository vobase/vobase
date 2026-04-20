import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'
import { createFilesService, installFilesService } from './service/files'
import { createProposalService, installProposalService } from './service/proposal'

export default defineModule({
  name: 'drive',
  version: '1.0',
  manifest,
  init(ctx) {
    installFilesService(createFilesService({ db: ctx.db, organizationId: ctx.organizationId }))
    installProposalService(createProposalService({ organizationId: ctx.organizationId }))
  },
})

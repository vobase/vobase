import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { setFilesDb } from './service/files'
import { createProposalService, installProposalService } from './service/proposal'

export default defineModule({
  name: 'drive',
  version: '1.0',
  manifest,
  routes: { basePath: '/api/drive', handler: handlers, requireSession: true },
  init(ctx) {
    setFilesDb(ctx.db)
    installProposalService(createProposalService({ organizationId: ctx.organizationId }))
  },
})

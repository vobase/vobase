import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { setFilesDb } from './service/files'
import { createProposalService, installProposalService } from './service/proposal'

export default defineModule({
  name: 'drive',
  version: '1.0',
  manifest: {
    provides: {
      commands: ['drive:ls', 'drive:cat', 'drive:grep', 'drive:find'],
      materializers: ['businessMdMaterializer', 'driveFolderMaterializer'],
      channels: [],
    },
    permissions: [],
    workspace: {
      owns: [{ kind: 'prefix', path: '/workspace/drive/' }],
      frozenEager: [{ kind: 'exact', path: '/workspace/drive/BUSINESS.md' }],
    },
  },
  routes: { basePath: '/api/drive', handler: handlers, requireSession: true },
  init(ctx) {
    setFilesDb(ctx.db)
    installProposalService(createProposalService({ organizationId: ctx.organizationId }))
  },
})

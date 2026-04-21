import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'
import { createProposalService, installProposalService } from './service/proposal'

export default defineModule({
  name: 'drive',
  version: '1.0',
  manifest,
  init(ctx) {
    installProposalService(createProposalService({ organizationId: ctx.organizationId }))
  },
})

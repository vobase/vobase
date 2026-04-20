import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'
import { setDb, setOrganizationId } from './service/files'
import { setOrganizationId as setProposalOrganizationId } from './service/proposal'

export default defineModule({
  name: 'drive',
  version: '1.0',
  manifest,
  init(ctx) {
    setDb(ctx.db)
    setOrganizationId(ctx.organizationId)
    setProposalOrganizationId(ctx.organizationId)
  },
})

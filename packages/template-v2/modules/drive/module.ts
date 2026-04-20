import { defineModule } from '@server/runtime/define-module'
import { manifest } from './manifest'
import { setDb, setTenantId } from './service/files'
import { setTenantId as setProposalTenantId } from './service/proposal'

export default defineModule({
  name: 'drive',
  version: '1.0',
  manifest,
  init(ctx) {
    setDb(ctx.db)
    setTenantId(ctx.organizationId)
    setProposalTenantId(ctx.organizationId)
  },
})

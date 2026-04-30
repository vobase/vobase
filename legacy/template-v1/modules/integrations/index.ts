import { defineModule } from '@vobase/core'

import { integrationsRoutes } from './handlers'
import { setIntegrationsDeps, whatsappSetupJob } from './jobs'

export const integrationsModule = defineModule({
  name: 'integrations',
  schema: {},
  routes: integrationsRoutes,
  jobs: [whatsappSetupJob],

  init(ctx) {
    setIntegrationsDeps(ctx.db, ctx.integrations)
  },
})

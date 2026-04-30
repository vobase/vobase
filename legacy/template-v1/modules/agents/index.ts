import { defineModule } from '@vobase/core'

import { agentsRoutes } from './handlers'
import { agentWakeJob } from './jobs'
import { configureTracing } from './mastra/lib/observability'
import * as schema from './schema'

export const agentsModule = defineModule({
  name: 'agents',
  schema,
  routes: agentsRoutes,
  jobs: [agentWakeJob],

  async init(_ctx) {
    configureTracing()
  },
})

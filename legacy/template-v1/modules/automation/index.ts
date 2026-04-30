import { defineModule, logger } from '@vobase/core'

import { automationRoutes } from './handlers'
import { sessionCleanupJob, taskTimeoutJob } from './jobs'
import { setModuleDeps } from './lib/automation-deps'
import * as schema from './schema'

export const automationModule = defineModule({
  name: 'automation',
  schema,
  routes: automationRoutes,
  jobs: [taskTimeoutJob, sessionCleanupJob],

  async init(ctx) {
    setModuleDeps({
      db: ctx.db,
      scheduler: ctx.scheduler,
      realtime: ctx.realtime,
      auth: ctx.auth,
    })

    await ctx.scheduler.add('automation:task-timeout', {}, { singletonKey: 'automation:task-timeout' }).catch(() => {})

    await ctx.scheduler
      .add('automation:session-cleanup', {}, { singletonKey: 'automation:session-cleanup' })
      .catch(() => {})

    logger.info('[automation] Init complete')
  },
})

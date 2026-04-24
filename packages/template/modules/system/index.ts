import { defineModule } from '@vobase/core'

import { systemRoutes } from './handlers'

export const systemModule = defineModule({
  name: 'system',
  schema: {},
  routes: systemRoutes,
})

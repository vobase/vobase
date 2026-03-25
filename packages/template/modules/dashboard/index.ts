import { defineModule } from '@vobase/core';

import { dashboardRoutes } from './handlers';

export const dashboardModule = defineModule({
  name: 'dashboard',
  schema: {},
  routes: dashboardRoutes,
  jobs: [],
});

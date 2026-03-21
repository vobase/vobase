import { defineModule } from '@vobase/core';

import { aiRoutes } from './handlers';
import { memoryFormationJob, setAiModuleDeps } from './jobs';
import * as schema from './schema';

export const aiModule = defineModule({
  name: 'ai',
  schema,
  routes: aiRoutes,
  jobs: [memoryFormationJob],

  init(ctx) {
    setAiModuleDeps(ctx.db, ctx.scheduler);
  },
});

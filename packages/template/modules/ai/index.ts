import { defineModule } from '@vobase/core';

import { configureTracing } from '../../mastra/lib/observability';
import { aiRoutes } from './handlers';
import {
  evalRunJob,
  followUpResumeJob,
  memoryFormationJob,
  setAiModuleDeps,
} from './jobs';
import * as schema from './schema';

export const aiModule = defineModule({
  name: 'ai',
  schema,
  routes: aiRoutes,
  jobs: [memoryFormationJob, evalRunJob, followUpResumeJob],

  init(ctx) {
    setAiModuleDeps(ctx.db, ctx.scheduler);
    configureTracing();
    // Mastra initialization is async — called from server.ts after createApp()
  },
});

import { defineModule } from '@vobase/core';

import { knowledgeBaseRoutes } from './handlers';
import { processDocumentJob, setModuleDb } from './jobs';
import * as schema from './schema';

export const knowledgeBaseModule = defineModule({
  name: 'knowledge-base',
  schema,
  routes: knowledgeBaseRoutes,
  jobs: [processDocumentJob],

  init(ctx) {
    setModuleDb(ctx.db);
  },
});

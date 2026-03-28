import type { VobaseModule } from '@vobase/core';

import { aiModule } from './ai';
import { integrationsModule } from './integrations';
import { knowledgeBaseModule } from './knowledge-base';
import { systemModule } from './system';

export const modules: VobaseModule[] = [
  systemModule,
  knowledgeBaseModule,
  aiModule,
  integrationsModule,
];

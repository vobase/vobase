import type { VobaseModule } from '@vobase/core';

import { aiModule } from './ai';
import { automationModule } from './automation';
import { integrationsModule } from './integrations';
import { knowledgeBaseModule } from './knowledge-base';
import { systemModule } from './system';

export const modules: VobaseModule[] = [
  systemModule,
  knowledgeBaseModule,
  aiModule,
  integrationsModule,
  automationModule,
];

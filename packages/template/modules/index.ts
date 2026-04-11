import type { VobaseModule } from '@vobase/core';

import { agentsModule } from './agents';
import { automationModule } from './automation';
import { integrationsModule } from './integrations';
import { knowledgeBaseModule } from './knowledge-base';
import { messagingModule } from './messaging';
import { systemModule } from './system';

export const modules: VobaseModule[] = [
  systemModule,
  knowledgeBaseModule,
  messagingModule,
  agentsModule,
  integrationsModule,
  automationModule,
];

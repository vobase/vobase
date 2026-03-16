import type { VobaseModule } from '@vobase/core';

import { integrationsModule } from './integrations';
import { knowledgeBaseModule } from './knowledge-base';
import { messagingModule } from './messaging';
import { systemModule } from './system';

export const modules: VobaseModule[] = [systemModule, knowledgeBaseModule, messagingModule, integrationsModule];

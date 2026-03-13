import type { VobaseModule } from '@vobase/core';

import { chatbotModule } from './chatbot';
import { knowledgeBaseModule } from './knowledge-base';
import { systemModule } from './system';

export const modules: VobaseModule[] = [systemModule, knowledgeBaseModule, chatbotModule];

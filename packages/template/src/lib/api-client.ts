import { hc } from 'hono/client';

import type { AiRoutes } from '../../modules/ai/handlers';
import type { AutomationRoutes } from '../../modules/automation/handlers';
import type { KnowledgeBaseRoutes } from '../../modules/knowledge-base/handlers';
import type { SystemRoutes } from '../../modules/system/handlers';

export const systemClient = hc<SystemRoutes>('/api/system');
export const aiClient = hc<AiRoutes>('/api/ai');
export const knowledgeBaseClient = hc<KnowledgeBaseRoutes>(
  '/api/knowledge-base',
);
export const automationClient = hc<AutomationRoutes>('/api/automation');

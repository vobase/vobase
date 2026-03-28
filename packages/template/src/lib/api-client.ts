import { hc } from 'hono/client';

import type { AiRoutes } from '../../modules/ai/handlers';
import type { IntegrationsRoutes } from '../../modules/integrations/handlers';
import type { KnowledgeBaseRoutes } from '../../modules/knowledge-base/handlers';
import type { SystemRoutes } from '../../modules/system/handlers';

export const systemClient = hc<SystemRoutes>('/api/system');
export const integrationsClient = hc<IntegrationsRoutes>('/api/integrations');
export const aiClient = hc<AiRoutes>('/api/ai');
export const knowledgeBaseClient = hc<KnowledgeBaseRoutes>(
  '/api/knowledge-base',
);

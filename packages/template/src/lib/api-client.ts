import { hc } from 'hono/client';

import type { SystemRoutes } from '../../modules/system/handlers';
import type { IntegrationsRoutes } from '../../modules/integrations/handlers';

export const systemClient = hc<SystemRoutes>('/api/system');
export const integrationsClient = hc<IntegrationsRoutes>('/api/integrations');

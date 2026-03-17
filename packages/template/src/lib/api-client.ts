import { hc } from 'hono/client';

import type { IntegrationsRoutes } from '../../modules/integrations/handlers';
import type { SystemRoutes } from '../../modules/system/handlers';

export const systemClient = hc<SystemRoutes>('/api/system');
export const integrationsClient = hc<IntegrationsRoutes>('/api/integrations');

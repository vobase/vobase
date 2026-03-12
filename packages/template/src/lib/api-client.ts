import { hc } from 'hono/client';

import type { SystemRoutes } from '../../modules/system/handlers';

export const systemClient = hc<SystemRoutes>('/api/system');

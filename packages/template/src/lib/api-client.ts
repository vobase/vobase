import { hc } from 'hono/client';

import type { AppType } from '../../server';

/** System routes (health, audit, etc.) */
export const apiClient = hc<AppType>('/');

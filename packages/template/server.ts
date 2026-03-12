import { createApp } from '@vobase/core';

import { modules } from './modules';
import config from './vobase.config';

const app = createApp({ ...config, modules });

export default app;
// Re-export the generated AppType which preserves Hono's literal route types
// for use with hc<AppType>() in the frontend
export type { AppType } from './src/api-types.generated';

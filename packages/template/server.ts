import { createApp } from '@vobase/core';

import { setupSqliteVec } from './lib/sqlite-vec';
import { modules } from './modules';
import config from './vobase.config';

// Must run before createApp() which creates the Database instance
setupSqliteVec();

const app = await createApp({ ...config, modules });

export default app;
// Re-export the generated AppType which preserves Hono's literal route types
// for use with hc<AppType>() in the frontend
export type { AppType } from './src/api-types.generated';

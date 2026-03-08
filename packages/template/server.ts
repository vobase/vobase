import { createApp } from '@vobase/core';

import { modules } from './modules';
import config from './vobase.config';

const app = createApp({ ...config, modules });

export default app;
export type AppType = typeof app;

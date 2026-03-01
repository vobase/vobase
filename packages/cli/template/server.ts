import { createApp } from '@vobase/core';
import config from './vobase.config';
import { modules } from './modules';

const app = createApp({ ...config, modules });

export default app;
export type AppType = typeof app;

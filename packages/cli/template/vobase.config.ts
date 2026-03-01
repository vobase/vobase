import type { CreateAppConfig } from '@vobase/core';

const config: Omit<CreateAppConfig, 'modules'> = {
  database: './data/vobase.db',
  storage: { basePath: './data/files' },
  mcp: { enabled: true },
};

export default config;

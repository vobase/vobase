import { Hono } from 'hono';

import type { VobaseDb } from '../../db/client';
import { defineJob } from '../../infra/job';
import { logger } from '../../infra/logger';
import { defineBuiltinModule } from '../../module';
import { refreshExpiringTokens } from './refresh-job';
import { integrationsSchema } from './schema';
import { createIntegrationsService } from './service';

export function createIntegrationsModule(db: VobaseDb) {
  const service = createIntegrationsService(db);

  const refreshTokensJob = defineJob(
    'integrations:refresh-tokens',
    async () => {
      const result = await refreshExpiringTokens(db, service);
      logger.info('[integrations:refresh-tokens] Job complete', result);
    },
  );

  const mod = defineBuiltinModule({
    name: '_integrations',
    schema: integrationsSchema,
    routes: new Hono(),
    jobs: [refreshTokensJob],
    init(ctx) {
      ctx.scheduler
        .schedule('integrations:refresh-tokens', '*/5 * * * *', {})
        .catch(() => {});
    },
  });

  return { ...mod, service };
}

export {
  getProviderRefreshFn,
  getRefreshMode,
  type ProviderRefreshFn,
  type RefreshResult,
  registerProviderRefresh,
} from './refresh';
export { integrationsSchema, integrationsTable } from './schema';
export type {
  ConnectOptions,
  Integration,
  IntegrationsService,
} from './service';
export { createIntegrationsService } from './service';

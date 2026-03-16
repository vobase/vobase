import { Hono } from 'hono';

import { defineBuiltinModule } from '../../module';
import { createIntegrationsService } from './service';
import { integrationsSchema } from './schema';
import type { VobaseDb } from '../../db/client';

export function createIntegrationsModule(db: VobaseDb) {
  const service = createIntegrationsService(db);

  const mod = defineBuiltinModule({
    name: '_integrations',
    schema: integrationsSchema,
    routes: new Hono(),
  });

  return { ...mod, service };
}

export { integrationsTable, integrationsSchema } from './schema';
export { createIntegrationsService } from './service';
export type { IntegrationsService, Integration, ConnectOptions } from './service';

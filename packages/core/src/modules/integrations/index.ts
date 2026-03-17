import { Hono } from 'hono';

import type { VobaseDb } from '../../db/client';
import { defineBuiltinModule } from '../../module';
import { integrationsSchema } from './schema';
import { createIntegrationsService } from './service';

export function createIntegrationsModule(db: VobaseDb) {
  const service = createIntegrationsService(db);

  const mod = defineBuiltinModule({
    name: '_integrations',
    schema: integrationsSchema,
    routes: new Hono(),
  });

  return { ...mod, service };
}

export { integrationsSchema, integrationsTable } from './schema';
export type {
  ConnectOptions,
  Integration,
  IntegrationsService,
} from './service';
export { createIntegrationsService } from './service';

import type { Auth } from '../auth';
import { defineModule, type VobaseModule } from '../module';
import { createSystemRoutes } from './handlers';
import { auditLog, recordAudits, sequences } from './schema';

export * from './schema';
export { createSystemRoutes } from './handlers';
export type SystemRoutes = ReturnType<typeof createSystemRoutes>;

export function createSystemModule(auth: Auth): VobaseModule {
  return defineModule({
    name: 'system',
    schema: { auditLog, sequences, recordAudits },
    routes: createSystemRoutes(auth),
  });
}

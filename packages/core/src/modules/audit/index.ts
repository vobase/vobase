import { Hono } from 'hono';

import { defineBuiltinModule } from '../../module';

import { auditLog, recordAudits } from './schema';

export { auditLog, recordAudits } from './schema';
export { trackChanges } from './track-changes';
export { requestAuditMiddleware, createAuthAuditHooks } from './middleware';

export function createAuditModule() {
  return defineBuiltinModule({
    name: '_audit',
    schema: { auditLog, recordAudits },
    routes: new Hono(),
    init: () => {},
  });
}

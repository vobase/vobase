import { createMiddleware } from 'hono/factory';

import type { VobaseDb } from '../../db/client';

import { auditLog } from './schema';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getRequestIp(headers: Headers | undefined): string {
  const forwardedFor = headers?.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || headers?.get('x-real-ip') || 'unknown';
}

export function requestAuditMiddleware(db: VobaseDb) {
  return createMiddleware(async (c, next) => {
    try {
      await next();
    } finally {
      if (MUTATION_METHODS.has(c.req.method)) {
        const user = c.get('user');
        db.insert(auditLog)
          .values({
            event: 'api_mutation',
            actorId: user?.id ?? null,
            actorEmail: user?.email ?? null,
            ip: getRequestIp(c.req.raw.headers),
            details: JSON.stringify({ method: c.req.method, path: c.req.path }),
          })
          .run();
      }
    }
  });
}

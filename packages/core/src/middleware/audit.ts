import { createAuthMiddleware } from 'better-auth/api';
import { createMiddleware } from 'hono/factory';

import { auditLog, type VobaseDb } from '../db';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const AUTH_EVENT_BY_PATH = {
  '/sign-in/email': 'signin',
  '/sign-up/email': 'signup',
  '/sign-out': 'signout',
} as const;

function getRequestIp(headers: Headers | undefined): string {
  const forwardedFor = headers?.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || headers?.get('x-real-ip') || 'unknown';
}

function writeAuditLog(
  db: VobaseDb,
  event: string,
  actorId: string | null,
  actorEmail: string | null,
  ip: string,
  details: Record<string, string>
): void {
  db.insert(auditLog)
    .values({
      event,
      actorId,
      actorEmail,
      ip,
      details: JSON.stringify(details),
    })
    .run();
}

export function requestAuditMiddleware(db: VobaseDb) {
  return createMiddleware(async (c, next) => {
    try {
      await next();
    } finally {
      if (MUTATION_METHODS.has(c.req.method)) {
        const user = c.get('user');
        writeAuditLog(
          db,
          'api_mutation',
          user?.id ?? null,
          user?.email ?? null,
          getRequestIp(c.req.raw.headers),
          { method: c.req.method, path: c.req.path }
        );
      }
    }
  });
}

export function createAuthAuditHooks(db: VobaseDb) {
  return {
    after: createAuthMiddleware(async (ctx) => {
      const event = AUTH_EVENT_BY_PATH[ctx.path as keyof typeof AUTH_EVENT_BY_PATH];
      if (!event) {
        return;
      }

      const actor = (ctx.context.newSession ?? ctx.context.session)?.user;
      writeAuditLog(
        db,
        event,
        actor?.id ?? null,
        actor?.email ?? null,
        getRequestIp(ctx.headers),
        { path: ctx.path }
      );
    }),
  };
}

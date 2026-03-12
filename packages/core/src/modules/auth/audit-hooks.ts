import { createAuthMiddleware } from 'better-auth/api';

import type { VobaseDb } from '../../db/client';
import { auditLog } from '../audit/schema';

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
  details: Record<string, string>,
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

export function createAuthAuditHooks(db: VobaseDb) {
  // Store user info before signout destroys the session
  const pendingSignout = new WeakMap<Headers, { id: string; email: string }>();

  return {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-out') {
        const user = ctx.context.session?.user;
        if (user && ctx.headers) {
          pendingSignout.set(ctx.headers, { id: user.id, email: user.email });
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      const event =
        AUTH_EVENT_BY_PATH[ctx.path as keyof typeof AUTH_EVENT_BY_PATH];
      if (!event) {
        return;
      }

      let actor = (ctx.context.newSession ?? ctx.context.session)?.user;

      // For signout, retrieve the user captured in the before hook
      if (!actor && ctx.path === '/sign-out' && ctx.headers) {
        actor = pendingSignout.get(ctx.headers) as typeof actor;
        pendingSignout.delete(ctx.headers);
      }

      writeAuditLog(
        db,
        event,
        actor?.id ?? null,
        actor?.email ?? null,
        getRequestIp(ctx.headers),
        { path: ctx.path },
      );
    }),
  };
}

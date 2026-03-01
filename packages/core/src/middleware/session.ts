import { createMiddleware } from 'hono/factory';

import type { Auth } from '../auth';
import { unauthorized } from '../errors';

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role?: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: { id: string; email: string; name: string; role: string } | null;
  }
}

export function sessionMiddleware(auth: Auth) {
  return createMiddleware(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      throw unauthorized();
    }

    c.set('user', {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: (session.user as unknown as SessionUser).role ?? 'user',
    });

    await next();
  });
}

export function optionalSessionMiddleware(auth: Auth) {
  return createMiddleware(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    c.set(
      'user',
      session
        ? {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            role: (session.user as unknown as SessionUser).role ?? 'user',
          }
        : null,
    );

    await next();
  });
}

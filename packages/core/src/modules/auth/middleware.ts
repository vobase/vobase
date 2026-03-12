import { createMiddleware } from 'hono/factory';

import type { AuthAdapter } from '../../contracts/auth';
import { unauthorized } from '../../infra/errors';

declare module 'hono' {
  interface ContextVariableMap {
    user: { id: string; email: string; name: string; role: string; activeOrganizationId?: string } | null;
  }
}

export function sessionMiddleware(adapter: AuthAdapter) {
  return createMiddleware(async (c, next) => {
    const session = await adapter.getSession(c.req.raw.headers);

    if (!session) {
      throw unauthorized();
    }

    c.set('user', {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role ?? 'user',
      activeOrganizationId: session.user.activeOrganizationId,
    });

    await next();
  });
}

export function optionalSessionMiddleware(adapter: AuthAdapter) {
  return createMiddleware(async (c, next) => {
    const session = await adapter.getSession(c.req.raw.headers);

    c.set(
      'user',
      session
        ? {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            role: session.user.role ?? 'user',
            activeOrganizationId: session.user.activeOrganizationId,
          }
        : null,
    );

    await next();
  });
}

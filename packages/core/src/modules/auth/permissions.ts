import { createMiddleware } from 'hono/factory';

import { forbidden } from '../../infra/errors';

export function requireRole(...roles: string[]) {
  return createMiddleware(async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      throw forbidden('Insufficient role');
    }
    await next();
  });
}

export function requirePermission(..._permissions: string[]) {
  return createMiddleware(async (c, next) => {
    const user = c.get('user');
    if (!user) throw forbidden('Authentication required');
    await next();
  });
}

export function requireOrg() {
  return createMiddleware(async (c, next) => {
    const user = c.get('user');
    if (!user?.activeOrganizationId) {
      throw forbidden('Active organization required');
    }
    await next();
  });
}

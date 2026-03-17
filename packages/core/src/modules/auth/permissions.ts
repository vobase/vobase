import { createMiddleware } from 'hono/factory';

import { forbidden } from '../../infra/errors';

let _organizationEnabled = false;

export function setOrganizationEnabled(enabled: boolean) {
  _organizationEnabled = enabled;
}

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
  if (!_organizationEnabled) {
    throw new Error(
      'Organization plugin required for permission-based auth. Use requireRole() instead or enable organization in config.',
    );
  }
  return createMiddleware(async (c, next) => {
    const user = c.get('user');
    if (!user) throw forbidden('Authentication required');
    await next();
  });
}

export function requireOrg() {
  if (!_organizationEnabled) {
    throw new Error(
      'Organization plugin required. Enable organization in config.',
    );
  }
  return createMiddleware(async (c, next) => {
    const user = c.get('user');
    if (!user?.activeOrganizationId) {
      throw forbidden('Active organization required');
    }
    await next();
  });
}

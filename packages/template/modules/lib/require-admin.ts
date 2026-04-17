import { authMember, forbidden, getCtx } from '@vobase/core';
import { and, eq, inArray } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';

/**
 * Allow users whose global role is 'admin', or who are 'owner'/'admin' of
 * their active organization (or any organization they belong to, since
 * better-auth may not surface activeOrganizationId on the user object).
 */
export function requireAdmin() {
  return createMiddleware(async (c, next) => {
    const { db, user } = getCtx(c);
    if (!user) throw forbidden('Authentication required');
    if (user.role === 'admin') {
      await next();
      return;
    }
    const conditions = [
      eq(authMember.userId, user.id),
      inArray(authMember.role, ['owner', 'admin']),
    ];
    if (user.activeOrganizationId) {
      conditions.push(eq(authMember.organizationId, user.activeOrganizationId));
    }
    const [row] = await db
      .select({ id: authMember.id })
      .from(authMember)
      .where(and(...conditions))
      .limit(1);
    if (row) {
      await next();
      return;
    }
    throw forbidden('Insufficient role');
  });
}

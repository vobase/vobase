import type { ScopedDb } from '@server/common/scoped-db'
import { authMember } from '@vobase/core'
import { and, eq } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'

import type { OrganizationEnv } from './require-organization'

export interface RoleEnv {
  Variables: OrganizationEnv['Variables'] & { memberRole: string }
}

/**
 * Must follow `requireSession` + `requireOrganization`. Built-in org roles are
 * `owner | admin | member`; dynamic AC can store them comma-separated
 * (`"admin,member"`), so we split before matching.
 */
export function createRequireRole(db: ScopedDb, allowedRoles: readonly [string, ...string[]]): MiddlewareHandler {
  const allowed = new Set(allowedRoles)
  return async (c: Context<RoleEnv>, next): Promise<Response | undefined> => {
    const session = c.get('session')
    const organizationId = c.get('organizationId')
    const rows = await db
      .select({ role: authMember.role })
      .from(authMember)
      .where(and(eq(authMember.userId, session.user.id), eq(authMember.organizationId, organizationId)))
      .limit(1)
    const rawRole = rows[0]?.role
    if (!rawRole) return c.json({ error: 'not a member of organization' }, 403)

    const roles = rawRole.split(',').map((r) => r.trim())
    const match = roles.find((r) => allowed.has(r))
    if (!match) return c.json({ error: 'insufficient role' }, 403)

    c.set('memberRole', match)
    await next()
    return undefined
  }
}

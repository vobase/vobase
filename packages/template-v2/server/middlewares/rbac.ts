/**
 * Typed permission helpers for template-v2.
 *
 * `requirePerm({ resource: [action, ...] })` — thin wrapper over
 * `createRequirePermission` that keys against the template-v2 AC statement so
 * typos surface at compile time.
 *
 * `scopeRbac()` — drive-scope-aware middleware. Reads `:scope` (and `contactId`/
 * `userId` as appropriate) from the request, then applies:
 *   - organization → write requires `drive:approve`, reads require `drive:read`.
 *   - contact      → any org member (session + membership already asserted upstream).
 *   - staff        → self or `staff:write:any` for writes; any org member for reads.
 *
 * Must sit after `requireSession` + `requireOrganization` so `c.get('session')`
 * and `c.get('organizationId')` are populated.
 */

import type { Context, MiddlewareHandler } from 'hono'

import type { Auth } from '../auth'
import type { statement } from '../auth/ac'
import type { OrganizationEnv } from './require-organization'
import { createRequirePermission } from './require-permission'

type Statement = typeof statement

type PermInput = {
  [K in keyof Statement]?: ReadonlyArray<Statement[K][number]>
}

/**
 * Typed wrapper over `createRequirePermission`. Accepts permissions only from
 * the template-v2 AC statement so we get a compile-time error if a handler
 * references a resource or action that doesn't exist.
 */
export function requirePerm(auth: Auth, perms: PermInput): MiddlewareHandler {
  return createRequirePermission(auth, perms as Record<string, string[]>)
}

export type DriveScopeKind = 'organization' | 'contact' | 'staff' | 'agent'

export interface ScopeRbacOptions {
  /** How to read the scope discriminator. Defaults to query param `scope`. */
  readScope?: (c: Context<OrganizationEnv>) => DriveScopeKind | undefined
  /** How to read the target userId for staff scope (self-check). */
  readStaffUserId?: (c: Context<OrganizationEnv>) => string | undefined
  /** `true` if the route mutates. Mutations trigger stricter checks. */
  write: boolean
}

/**
 * Scope-parametric RBAC for `/api/drive/*`. Keyed off the `scope` request
 * parameter (organization|contact|staff). Called per-route because mutation
 * vs read changes the required permission.
 */
export function scopeRbac(auth: Auth, opts: ScopeRbacOptions): MiddlewareHandler {
  const readScope =
    opts.readScope ?? ((c) => (c.req.query('scope') ?? c.req.param('scope')) as DriveScopeKind | undefined)
  const readStaffUserId = opts.readStaffUserId ?? ((c) => c.req.query('userId') ?? c.req.param('userId') ?? undefined)

  return async (c: Context<OrganizationEnv>, next): Promise<Response | undefined> => {
    const scope = readScope(c)
    if (scope !== 'organization' && scope !== 'contact' && scope !== 'staff' && scope !== 'agent') {
      return c.json({ error: 'invalid_scope' }, 400)
    }

    if (scope === 'organization') {
      const action = opts.write ? 'approve' : 'read'
      return (await createRequirePermission(auth, { drive: [action] })(c, next)) ?? undefined
    }

    if (scope === 'contact' || scope === 'agent') {
      // Any org member may read/write contact- and agent-scope Drive files;
      // session + org membership already enforced upstream.
      await next()
      return undefined
    }

    // staff scope
    const session = c.get('session')
    const targetUserId = readStaffUserId(c)
    const isSelf = !!targetUserId && targetUserId === session.user.id
    if (!opts.write || isSelf) {
      await next()
      return undefined
    }
    return (await createRequirePermission(auth, { staff: ['write:any'] })(c, next)) ?? undefined
  }
}

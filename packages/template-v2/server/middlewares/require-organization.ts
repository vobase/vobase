import type { ScopedDb } from '@server/contracts/scoped-db'
import { authMember } from '@vobase/core'
import { eq } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import type { Auth } from '../auth'
import type { SessionEnv } from './require-session'

export interface OrganizationEnv {
  Variables: SessionEnv['Variables'] & { organizationId: string }
}

/**
 * Module-level handles so the stateless `requireOrganization` export below can
 * look up fallback memberships and persist activeOrganizationId on the
 * session. Installed from `server/app.ts` via `installOrganizationContext()`.
 *
 * Stateless here (no factory + no call-site wiring) because most modules only
 * need `requireOrganization` as an import and don't want a DI ceremony.
 */
let _db: ScopedDb | null = null
let _auth: Auth | null = null

export function installOrganizationContext(ctx: { db: ScopedDb; auth: Auth }): void {
  _db = ctx.db
  _auth = ctx.auth
}

export function __resetOrganizationContextForTests(): void {
  _db = null
  _auth = null
}

/**
 * Must follow `requireSession`.
 *
 * Resolution order:
 *   1. `session.session.activeOrganizationId` — fast path (cookie cache keeps
 *      it hot for 5min).
 *   2. Fallback: look up the user's first `auth.member` row and
 *      `auth.api.setActiveOrganization` so subsequent requests hit the fast
 *      path. Covers dev-plugin / platform-plugin / emailOTP sessions minted
 *      before we started tracking `activeOrganizationId`.
 *   3. 403 "no organization" if the user has no memberships at all.
 */
export const requireOrganization: MiddlewareHandler = async (
  c: Context<OrganizationEnv>,
  next,
): Promise<Response | undefined> => {
  const session = c.get('session')
  let organizationId = session.session.activeOrganizationId

  if (!organizationId) {
    if (!_db || !_auth) return c.json({ error: 'no active organization' }, 403)
    const rows = await _db
      .select({ organizationId: authMember.organizationId })
      .from(authMember)
      .where(eq(authMember.userId, session.user.id))
      .limit(1)
    const fallback = rows[0]?.organizationId
    if (!fallback) {
      return c.json({ error: 'user is not a member of any organization' }, 403)
    }
    organizationId = fallback
    // Persist for subsequent requests. Best-effort: tolerate failure so the
    // current request isn't blocked by a setActive edge case — we have the id
    // in-hand already.
    try {
      const api = _auth.api as unknown as {
        setActiveOrganization: (opts: { headers: Headers; body: { organizationId: string } }) => Promise<unknown>
      }
      await api.setActiveOrganization({
        headers: c.req.raw.headers,
        body: { organizationId: fallback },
      })
    } catch {
      // no-op; fall through to c.set below
    }
  }

  c.set('organizationId', organizationId)
  await next()
  return undefined
}

/**
 * Pending-invitation handlers — list + resend + revoke. Mutations are admin-only
 * (mirrors the `channels` umbrella's `requireAdmin` gate). Reads are open to any
 * org member because they only surface email + role + expiry, which the staff
 * roster already exposes.
 *
 * The invite-MINT path lives in better-auth's organization plugin and is hit
 * directly from `<InviteMemberDialog>` via `authClient.organization.inviteMember`;
 * we do NOT replicate it here.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { getRequireAdmin } from '@modules/team/service/admin-gate'
import { listPending, resendInvitation, revokeInvitation } from '@modules/team/service/invitations'
import { VobaseError } from '@vobase/core'
import { Hono, type MiddlewareHandler } from 'hono'

/** Lazy admin gate — resolves the middleware installed in `module.ts:init`. */
// biome-ignore lint/suspicious/useAwait: Hono MiddlewareHandler contract requires async signature
const lazyRequireAdmin: MiddlewareHandler = async (c, next) => {
  const mw = getRequireAdmin()
  if (!mw) return c.json({ error: 'auth not initialised' }, 503)
  return mw(c, next)
}

function toErrorResponse(c: { json: (b: unknown, s: number) => Response }, err: unknown): Response {
  if (err instanceof VobaseError) {
    return c.json({ error: err.code, message: err.message }, err.statusCode as 400 | 401 | 403 | 404 | 409)
  }
  throw err
}

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/invitations', async (c) => {
    const rows = await listPending(c.get('organizationId'))
    return c.json(rows)
  })
  .post('/invitations/:id/resend', lazyRequireAdmin, async (c) => {
    try {
      await resendInvitation(c.get('organizationId'), c.req.param('id'))
      return c.body(null, 204)
    } catch (err) {
      return toErrorResponse(c, err)
    }
  })
  .delete('/invitations/:id', lazyRequireAdmin, async (c) => {
    try {
      await revokeInvitation(c.get('organizationId'), c.req.param('id'))
      return c.body(null, 204)
    } catch (err) {
      return toErrorResponse(c, err)
    }
  })

export default app

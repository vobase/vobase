import type { Context, MiddlewareHandler } from 'hono'
import type { SessionEnv } from './require-session'

export interface OrganizationEnv {
  Variables: SessionEnv['Variables'] & { organizationId: string }
}

/**
 * Must follow `requireSession`. `activeOrganizationId` is set client-side via
 * `authClient.organization.setActive({...})` or server-side via the org plugin's
 * `databaseHooks.session.create.before`.
 */
export const requireOrganization: MiddlewareHandler = async (
  c: Context<OrganizationEnv>,
  next,
): Promise<Response | undefined> => {
  const session = c.get('session')
  const organizationId = session.session.activeOrganizationId
  if (!organizationId) {
    return c.json({ error: 'no active organization' }, 403)
  }
  c.set('organizationId', organizationId)
  await next()
  return undefined
}

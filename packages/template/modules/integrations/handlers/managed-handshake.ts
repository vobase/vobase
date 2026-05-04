/**
 * `POST /api/integrations/vobase-platform/handshake` — admin-initiated tenant→platform
 * managed-channel handshake.
 *
 * The auto-provisioner runs at boot for the `META_PLATFORM_AUTO_PROVISION=true`
 * path; this handler is the manual fallback for staff who skipped auto-provision
 * (e.g., bumped pool capacity after tenant came up empty) and want to retry.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { getRequireAdmin } from '@modules/channels/service/state'
import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'

import { autoProvisionManagedWhatsApp } from '../service/auto-provision'

const handshakeBody = z.object({
  environment: z.enum(['production', 'staging']),
  channelInstanceId: z.string().min(1),
})

// Reuses the channels module's `requireAdmin` middleware (single source of
// truth for the admin gate; the integrations module is already topologically
// after channels via `requires`).
const lazyRequireAdmin: MiddlewareHandler = async (c, next) => {
  const mw = getRequireAdmin()
  if (!mw) return c.json({ error: 'auth not initialised' }, 503)
  return mw(c, next)
}

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .use('*', lazyRequireAdmin)
  .post('/vobase-platform/handshake', async (c) => {
    const parsed = handshakeBody.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    }
    const result = await autoProvisionManagedWhatsApp({
      organizationId: c.get('organizationId'),
      environment: parsed.data.environment,
      channelInstanceId: parsed.data.channelInstanceId,
    })
    if (result.status === 'pool_exhausted') {
      return c.json({ error: 'pool_exhausted' }, 503)
    }
    if (result.status === 'error') {
      return c.json({ error: result.reason ?? 'handshake_failed' }, 502)
    }
    return c.json(result)
  })

export default app

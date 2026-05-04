/**
 * Managed-mode WhatsApp release endpoint.
 *
 * `DELETE /api/channels/whatsapp/managed/:instanceId` — staff-initiated
 * release. Calls the platform's `POST /api/managed-whatsapp/tenant/release`,
 * then drops the local `channel_instances` row on success.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { getInstance, removeInstance } from '@modules/channels/service/instances'
import { PlatformHandshakeError, releaseWithPlatform } from '@modules/integrations/service/handshake'
import { Hono } from 'hono'

const app = new Hono<OrganizationEnv>().use('*', requireOrganization).delete('/managed/:instanceId', async (c) => {
  const instanceId = c.req.param('instanceId')
  const organizationId = c.get('organizationId')
  const row = await getInstance(instanceId)

  if (!row || row.organizationId !== organizationId) {
    return c.json({ error: 'not_found' }, 404)
  }
  if (row.channel !== 'whatsapp' || row.config.mode !== 'managed') {
    return c.json({ error: 'not_managed' }, 400)
  }

  const platformBaseUrl = (row.config.platformBaseUrl as string | undefined) ?? ''
  const environment = (row.config.environment as 'production' | 'staging' | undefined) ?? 'production'
  const tenantId = process.env.PLATFORM_TENANT_ID ?? ''
  const tenantHmacSecret = process.env.PLATFORM_HMAC_SECRET ?? ''

  if (!platformBaseUrl || !tenantId || !tenantHmacSecret) {
    return c.json({ error: 'platform_not_configured' }, 500)
  }

  try {
    await releaseWithPlatform({
      platformBaseUrl,
      tenantId,
      tenantHmacSecret,
      environment,
    })
  } catch (err) {
    if (err instanceof PlatformHandshakeError) {
      // Always surface as 502 — the platform-side status code may not match
      // hono's `ContentfulStatusCode` literal union, so we collapse here.
      return c.json({ error: 'platform_release_failed', detail: err.message }, 502)
    }
    throw err
  }

  await removeInstance(instanceId, organizationId)
  return c.json({ released: true })
})

export default app

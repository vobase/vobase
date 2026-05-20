/** @contract platform-tenant-v1 */
/**
 * One-shot, idempotent provisioning of the per-org platform notification
 * number + magic-link finish endpoint. Runs as the last step of
 * `claimAndBootstrap`. Three platform POSTs (claim → webhook×2), then
 * upsert `notification_settings`. Throws on failure; the caller's sandbox
 * row is already committed, so a retry re-enters with sandbox no-ops + the
 * platform's idempotent `(tenant, provider, webhook_url)` UNIQUE.
 */

import { getNotificationSettings, upsertNotificationSettings } from '@modules/channels/service/notification-settings'
import { registerWebhookWithPlatform, signedPlatformRequest } from '@modules/integrations/service/handshake'

import type { ScopedDb } from '~/runtime'

export interface ProvisionNotificationOpts {
  tenantId: string
  tenantHmacSecret: string
  platformBaseUrl: string
  /** Tenant app base URL — used for the `magic_link` webhook (`/auth/magic-finish`). */
  appBaseUrl: string
}

interface Allocation {
  platformChannelId: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string
  routineSecret: string
}

export async function provisionNotificationSettings(
  db: ScopedDb,
  organizationId: string,
  opts: ProvisionNotificationOpts,
): Promise<void> {
  if (await getNotificationSettings(db, organizationId)) return

  const { res } = await signedPlatformRequest({
    method: 'POST',
    platformBaseUrl: opts.platformBaseUrl,
    tenantId: opts.tenantId,
    tenantHmacSecret: opts.tenantHmacSecret,
    path: '/api/managed-whatsapp/notification/claim',
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error(`notification claim failed (${res.status})`)
  const alloc = (await res.json()) as Allocation

  const notifWebhookUrl = `${opts.platformBaseUrl.replace(/\/$/, '')}/api/managed-whatsapp/notification/inbound/${alloc.platformChannelId}`
  const notif = await registerWebhookWithPlatform({
    platformBaseUrl: opts.platformBaseUrl,
    tenantId: opts.tenantId,
    tenantHmacSecret: opts.tenantHmacSecret,
    provider: 'whatsapp_notif',
    webhookUrl: notifWebhookUrl,
    verifyToken: crypto.randomUUID().replace(/-/g, ''),
  })

  const magic = await registerWebhookWithPlatform({
    platformBaseUrl: opts.platformBaseUrl,
    tenantId: opts.tenantId,
    tenantHmacSecret: opts.tenantHmacSecret,
    provider: 'magic_link',
    webhookUrl: `${opts.appBaseUrl.replace(/\/$/, '')}/auth/magic-finish`,
    verifyToken: `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ''),
  })

  await upsertNotificationSettings(db, {
    organizationId,
    notificationEndpointId: notif.endpointId,
    magicLinkEndpointId: magic.endpointId,
    platformHmacSecret: alloc.routineSecret,
    platformBaseUrl: opts.platformBaseUrl,
    displayPhoneNumber: alloc.displayPhoneNumber,
    phoneNumberId: alloc.phoneNumberId,
    wabaId: alloc.wabaId,
  })
}

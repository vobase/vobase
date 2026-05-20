/**
 * Per-org notification text send seam. Reads `notification_settings` for the
 * platform base URL + envelope-encrypted HMAC secret, then dispatches via
 * the existing `signedPlatformRequest` helper from
 * `integrations/service/handshake.ts` — same v2 2-key signing + header
 * surface used by every other tenant-to-platform call.
 *
 * Note: the template-send path lives in `integrations/service/handshake.ts`
 * (`sendNotificationTemplate`) — it owns within-24h branching and the
 * `meta_131047` freeform→template fallback. This module is the text-only
 * counterpart used by the wake notification-mirror observer to relay a
 * standalone-lane assistant reply back to the operator's personal WA.
 */

import { PlatformHandshakeError, signedPlatformRequest } from '@modules/integrations/service/handshake'
import { logger } from '@vobase/core'

import type { ScopedDb } from '~/runtime'
import { decryptNotificationHmac, getNotificationSettings, NotificationSettingsError } from './notification-settings'

export interface NotificationSendResult {
  success: boolean
  messageId: string | null
  wireRoute: 'freeform' | 'template' | 'freeform_fallback_template'
  code?: string
  error?: string
}

export interface SendNotificationTextInput {
  to: string
  text: string
}

/**
 * Read `PLATFORM_TENANT_ID` once per call. `tenantId` is a process-wide
 * identity, not per-org.
 */
function readTenantId(): string {
  const id = process.env.PLATFORM_TENANT_ID?.trim() ?? ''
  if (!id) throw new Error('channels/notification-send: PLATFORM_TENANT_ID env var is required')
  return id
}

/**
 * Send a free-form text message via the platform's `/api/whatsapp/freeform`
 * endpoint. Returns a typed `NotificationSendResult` — no throws on
 * unconfigured orgs (returns `success: false` with a code instead) so
 * callers can fall back without exception-driven control flow.
 */
export async function sendNotificationText(
  db: ScopedDb,
  orgId: string,
  input: SendNotificationTextInput,
): Promise<NotificationSendResult> {
  const settings = await getNotificationSettings(db, orgId)
  if (!settings) {
    return { success: false, messageId: null, wireRoute: 'freeform', code: 'no_notification_settings' }
  }
  let hmacSecret: string
  try {
    hmacSecret = await decryptNotificationHmac(db, orgId)
  } catch (err) {
    if (err instanceof NotificationSettingsError) {
      return { success: false, messageId: null, wireRoute: 'freeform', code: err.code, error: err.message }
    }
    throw err
  }
  const body = JSON.stringify({
    staffPhoneE164: input.to,
    bodyText: input.text,
    idempotencyKey: crypto.randomUUID(),
  })
  try {
    const { res } = await signedPlatformRequest({
      method: 'POST',
      platformBaseUrl: settings.platformBaseUrl,
      tenantId: readTenantId(),
      tenantHmacSecret: hmacSecret,
      path: '/api/whatsapp/freeform',
      body,
    })
    if (!res.ok) {
      let code: string | undefined
      try {
        const payload = (await res.json()) as { code?: string } | null
        code = payload?.code
      } catch {
        code = undefined
      }
      return {
        success: false,
        messageId: null,
        wireRoute: 'freeform',
        code: code ?? `http_${res.status}`,
        error: `platform freeform send failed (${res.status})`,
      }
    }
    const parsed = (await res.json()) as { messageId?: string | null }
    return { success: true, messageId: parsed.messageId ?? null, wireRoute: 'freeform' }
  } catch (err) {
    if (err instanceof PlatformHandshakeError) {
      return {
        success: false,
        messageId: null,
        wireRoute: 'freeform',
        code: err.code ?? `platform_${err.status ?? 'error'}`,
        error: err.message,
      }
    }
    logger.warn({ err, orgId }, '[channels/notification-send] freeform request threw')
    return {
      success: false,
      messageId: null,
      wireRoute: 'freeform',
      code: 'send_threw',
      error: err instanceof Error ? err.message : 'unknown',
    }
  }
}

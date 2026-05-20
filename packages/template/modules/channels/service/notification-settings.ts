/**
 * Sole-writer service for `channels.notification_settings` — the per-org row
 * that holds the platform notification endpoint ids plus the envelope-encrypted
 * HMAC secret used to sign tenant-to-platform notification calls.
 *
 * Envelope encryption reuses `@vobase/core`'s `encryptSecretEnvelope` /
 * `decryptSecretEnvelope` — same KEK-wraps-DEK scheme used by
 * `integrations/service/vault.ts`. The serialized envelope is base64-JSON in
 * a single `text` column so the row stays self-contained without a
 * cross-schema FK to `integrations.secrets`.
 */

import { notificationSettings } from '@modules/channels/schema'
import { decryptSecretEnvelope, encryptSecretEnvelope, type SecretEnvelope } from '@vobase/core'
import { eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

export type NotificationSettings = typeof notificationSettings.$inferSelect

export interface UpsertNotificationSettingsInput {
  organizationId: string
  notificationEndpointId: string
  magicLinkEndpointId: string
  /** Plaintext — envelope-encrypted before persistence. */
  platformHmacSecret: string
  platformBaseUrl: string
  displayPhoneNumber?: string | null
  phoneNumberId?: string | null
  wabaId?: string | null
}

export type NotificationSettingsErrorCode = 'no_notification_settings' | 'hmac_decrypt_failed'

export class NotificationSettingsError extends Error {
  override name = 'NotificationSettingsError'
  code: NotificationSettingsErrorCode
  constructor(code: NotificationSettingsErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code)
    this.code = code
    if (options?.cause !== undefined) {
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }
}

/**
 * Serialize a `SecretEnvelope` (Buffer-typed) to a base64-encoded JSON
 * string so it can live in a single `text` column without a custom Drizzle
 * column type. Mirrors `integrations/vault::serializeEnvelope`.
 */
function serializeEnvelope(env: SecretEnvelope): string {
  return Buffer.from(
    JSON.stringify({
      kekVersion: env.kekVersion,
      dekCiphertext: env.dekCiphertext.toString('base64'),
      payloadCiphertext: env.payloadCiphertext.toString('base64'),
      iv: env.iv.toString('base64'),
      tag: env.tag.toString('base64'),
    }),
    'utf8',
  ).toString('base64')
}

function deserializeEnvelope(encoded: string): SecretEnvelope {
  const json = Buffer.from(encoded, 'base64').toString('utf8')
  const obj = JSON.parse(json) as {
    kekVersion: number
    dekCiphertext: string
    payloadCiphertext: string
    iv: string
    tag: string
  }
  return {
    kekVersion: obj.kekVersion,
    dekCiphertext: Buffer.from(obj.dekCiphertext, 'base64'),
    payloadCiphertext: Buffer.from(obj.payloadCiphertext, 'base64'),
    iv: Buffer.from(obj.iv, 'base64'),
    tag: Buffer.from(obj.tag, 'base64'),
  }
}

export async function getNotificationSettings(db: ScopedDb, orgId: string): Promise<NotificationSettings | null> {
  const rows = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.organizationId, orgId))
    .limit(1)
  return rows[0] ?? null
}

export async function upsertNotificationSettings(
  db: ScopedDb,
  input: UpsertNotificationSettingsInput,
): Promise<NotificationSettings> {
  const envelope = serializeEnvelope(encryptSecretEnvelope(input.platformHmacSecret))
  const values = {
    organizationId: input.organizationId,
    notificationEndpointId: input.notificationEndpointId,
    magicLinkEndpointId: input.magicLinkEndpointId,
    platformHmacSecretEnvelope: envelope,
    platformBaseUrl: input.platformBaseUrl,
    displayPhoneNumber: input.displayPhoneNumber ?? null,
    phoneNumberId: input.phoneNumberId ?? null,
    wabaId: input.wabaId ?? null,
  }
  const rows = await db
    .insert(notificationSettings)
    .values(values)
    .onConflictDoUpdate({
      target: notificationSettings.organizationId,
      set: {
        notificationEndpointId: values.notificationEndpointId,
        magicLinkEndpointId: values.magicLinkEndpointId,
        platformHmacSecretEnvelope: values.platformHmacSecretEnvelope,
        platformBaseUrl: values.platformBaseUrl,
        displayPhoneNumber: values.displayPhoneNumber,
        phoneNumberId: values.phoneNumberId,
        wabaId: values.wabaId,
      },
    })
    .returning()
  const row = rows[0]
  if (!row) throw new Error('channels/notification-settings: upsert returned no row')
  return row
}

/**
 * Read + decrypt the per-org platform HMAC secret. Throws a typed
 * `NotificationSettingsError` so callers can distinguish "row missing"
 * (`no_notification_settings`) from "envelope decrypt failed"
 * (`hmac_decrypt_failed` — e.g. `BETTER_AUTH_SECRET` rotated without
 * re-encryption). Decrypt errors are NOT swallowed.
 */
export async function decryptNotificationHmac(db: ScopedDb, orgId: string): Promise<string> {
  const settings = await getNotificationSettings(db, orgId)
  if (!settings) {
    throw new NotificationSettingsError('no_notification_settings', `no notification_settings row for org=${orgId}`)
  }
  try {
    return decryptSecretEnvelope(deserializeEnvelope(settings.platformHmacSecretEnvelope))
  } catch (err) {
    throw new NotificationSettingsError('hmac_decrypt_failed', 'failed to decrypt platform HMAC envelope', {
      cause: err,
    })
  }
}

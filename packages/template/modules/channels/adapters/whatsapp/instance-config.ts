/**
 * Helpers for the WhatsApp `channel_instances.config` JSONB shape used by the
 * Embedded Signup pipeline. Two concerns:
 *
 *   1. Envelope-encrypt the BISU access token at rest. The ciphertext fields
 *      live directly on the instance row (no separate `core.integrations`
 *      row) — keeps the row self-contained and removes a cross-schema lookup
 *      from outbound dispatch.
 *
 *   2. Read `META_APP_ID` / `META_APP_SECRET` / `META_APP_API_VERSION` from
 *      env with a single helper so handlers + jobs agree on the lookup
 *      contract.
 *
 * The plaintext access token is NEVER persisted in the config blob — only the
 * envelope ciphertext is. `decryptInstanceAccessToken` materialises it on
 * demand for outbound dispatch + the `whatsapp:setup` job.
 */
import { CURRENT_KEK_VERSION, decryptSecretEnvelope, encryptSecretEnvelope, type SecretEnvelope } from '@vobase/core'

import type { MetaOAuthConfig } from './meta-oauth'

export const ENCRYPTED_ACCESS_TOKEN_MARKER = 'encrypted:envelope:v1' as const

export interface EncryptedAccessTokenBlob {
  marker: typeof ENCRYPTED_ACCESS_TOKEN_MARKER
  kekVersion: number
  dekCiphertext: string
  payloadCiphertext: string
  iv: string
  tag: string
}

export interface WhatsappInstanceConfig {
  mode: 'self' | 'managed'
  coexistence: boolean
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber?: string
  appId?: string
  apiVersion?: string
  appSecret?: string
  webhookVerifyToken?: string
  accessTokenEnvelope?: EncryptedAccessTokenBlob
}

export function encodeAccessTokenEnvelope(envelope: SecretEnvelope): EncryptedAccessTokenBlob {
  return {
    marker: ENCRYPTED_ACCESS_TOKEN_MARKER,
    kekVersion: envelope.kekVersion,
    dekCiphertext: envelope.dekCiphertext.toString('base64'),
    payloadCiphertext: envelope.payloadCiphertext.toString('base64'),
    iv: envelope.iv.toString('base64'),
    tag: envelope.tag.toString('base64'),
  }
}

export function decodeAccessTokenEnvelope(blob: EncryptedAccessTokenBlob): SecretEnvelope {
  return {
    kekVersion: blob.kekVersion,
    dekCiphertext: Buffer.from(blob.dekCiphertext, 'base64'),
    payloadCiphertext: Buffer.from(blob.payloadCiphertext, 'base64'),
    iv: Buffer.from(blob.iv, 'base64'),
    tag: Buffer.from(blob.tag, 'base64'),
  }
}

export function buildEncryptedAccessTokenField(plaintextToken: string): EncryptedAccessTokenBlob {
  const envelope = encryptSecretEnvelope(plaintextToken)
  if (envelope.kekVersion !== CURRENT_KEK_VERSION) {
    throw new Error(`whatsapp/instance-config: unexpected KEK version ${envelope.kekVersion}`)
  }
  return encodeAccessTokenEnvelope(envelope)
}

export function decryptInstanceAccessToken(config: WhatsappInstanceConfig): string {
  if (!config.accessTokenEnvelope || config.accessTokenEnvelope.marker !== ENCRYPTED_ACCESS_TOKEN_MARKER) {
    throw new Error('whatsapp/instance-config: missing or malformed accessTokenEnvelope')
  }
  return decryptSecretEnvelope(decodeAccessTokenEnvelope(config.accessTokenEnvelope))
}

const DEFAULT_API_VERSION = 'v22.0'

export function loadMetaOAuthConfigFromEnv(): MetaOAuthConfig {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    throw new Error('whatsapp/instance-config: META_APP_ID and META_APP_SECRET must be set to run Embedded Signup')
  }
  return {
    appId,
    appSecret,
    apiVersion: process.env.META_APP_API_VERSION ?? DEFAULT_API_VERSION,
  }
}

export interface MetaSignupConfigIds {
  cloud: string | null
  coexistence: string | null
}

export function loadSignupConfigIdsFromEnv(): MetaSignupConfigIds {
  return {
    cloud: process.env.META_APP_CONFIG_ID_CLOUD ?? null,
    coexistence: process.env.META_APP_CONFIG_ID_COEXISTENCE ?? null,
  }
}

/**
 * Narrow a `channel_instances.config` JSONB blob to `WhatsappInstanceConfig`,
 * throwing if the shape is wrong. Used by the setup job + outbound dispatch
 * so the adapter never reaches into untyped config.
 */
export function parseWhatsappInstanceConfig(raw: unknown): WhatsappInstanceConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('whatsapp/instance-config: config blob is not an object')
  }
  const cfg = raw as Record<string, unknown>
  const mode = cfg.mode
  if (mode !== 'self' && mode !== 'managed') {
    throw new Error(`whatsapp/instance-config: invalid mode ${String(mode)}`)
  }
  if (typeof cfg.wabaId !== 'string' || cfg.wabaId.length === 0) {
    throw new Error('whatsapp/instance-config: missing wabaId')
  }
  if (typeof cfg.phoneNumberId !== 'string' || cfg.phoneNumberId.length === 0) {
    throw new Error('whatsapp/instance-config: missing phoneNumberId')
  }
  return {
    mode,
    coexistence: cfg.coexistence === true,
    wabaId: cfg.wabaId,
    phoneNumberId: cfg.phoneNumberId,
    displayPhoneNumber: typeof cfg.displayPhoneNumber === 'string' ? cfg.displayPhoneNumber : undefined,
    appId: typeof cfg.appId === 'string' ? cfg.appId : undefined,
    apiVersion: typeof cfg.apiVersion === 'string' ? cfg.apiVersion : undefined,
    appSecret: typeof cfg.appSecret === 'string' ? cfg.appSecret : undefined,
    webhookVerifyToken: typeof cfg.webhookVerifyToken === 'string' ? cfg.webhookVerifyToken : undefined,
    accessTokenEnvelope:
      cfg.accessTokenEnvelope && typeof cfg.accessTokenEnvelope === 'object'
        ? (cfg.accessTokenEnvelope as EncryptedAccessTokenBlob)
        : undefined,
  }
}

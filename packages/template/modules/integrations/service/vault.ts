/**
 * Tenant-side secret vault for platform-managed integrations.
 *
 * Wraps the core envelope-encryption helpers + the `integrations.secrets`
 * table. Single-writer per (organization, provider) — every read +
 * mutation flows through here so the encryption seam is auditable.
 *
 * The two-key contract (`routineSecret` + `rotationKey` + monotonic
 * `keyVersion`) mirrors `@vobase/core` `signRequest`/`verifyRequest` so the
 * tenant can sign + verify against the vault without re-deriving anything.
 */

import { decryptSecretEnvelope, encryptSecretEnvelope, type SecretEnvelope } from '@vobase/core'
import { and, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { integrationSecrets } from '../schema'

export type VaultProvider = 'vobase-platform'

export interface VaultPair {
  routineSecret: string
  rotationKey: string
  keyVersion: number
}

export interface VaultRotation {
  current: VaultPair
  previous: (VaultPair & { validUntil: Date }) | null
}

interface VaultDeps {
  db: ScopedDb
  organizationId: string
}

/** Serialize an envelope to base64 JSON for the text column. */
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

function encryptToString(plaintext: string): string {
  return serializeEnvelope(encryptSecretEnvelope(plaintext))
}

function decryptFromString(encoded: string): string {
  return decryptSecretEnvelope(deserializeEnvelope(encoded))
}

export interface IntegrationsVault {
  /** Persist a fresh secret pair, replacing any existing row. Used on first handshake. */
  storeSecret(provider: VaultProvider, pair: VaultPair): Promise<void>
  /** Read the current + (optional) previous pair. Returns null if not set. */
  readSecret(provider: VaultProvider): Promise<VaultRotation | null>
  /**
   * Rotate to a new pair. Promotes current → previous (with grace window),
   * sets new pair as current. Rejects monotonic downgrades.
   */
  rotate(provider: VaultProvider, next: VaultPair, previousValidUntil: Date): Promise<void>
}

export function createIntegrationsVault({ db, organizationId }: VaultDeps): IntegrationsVault {
  return {
    async storeSecret(provider, pair) {
      const routineEnv = encryptToString(pair.routineSecret)
      const rotationEnv = encryptToString(pair.rotationKey)
      await db
        .insert(integrationSecrets)
        .values({
          organizationId,
          provider,
          routineSecretEnvelope: routineEnv,
          rotationKeyEnvelope: rotationEnv,
          keyVersion: pair.keyVersion,
        })
        .onConflictDoUpdate({
          target: [integrationSecrets.organizationId, integrationSecrets.provider],
          set: {
            routineSecretEnvelope: routineEnv,
            rotationKeyEnvelope: rotationEnv,
            keyVersion: pair.keyVersion,
            // Clear stale previous pair on full re-store (re-handshake).
            routineSecretPreviousEnvelope: null,
            rotationKeyPreviousEnvelope: null,
            previousKeyVersion: null,
            previousValidUntil: null,
          },
        })
    },

    async readSecret(provider) {
      const [row] = await db
        .select({
          routineSecretEnvelope: integrationSecrets.routineSecretEnvelope,
          rotationKeyEnvelope: integrationSecrets.rotationKeyEnvelope,
          keyVersion: integrationSecrets.keyVersion,
          routineSecretPreviousEnvelope: integrationSecrets.routineSecretPreviousEnvelope,
          rotationKeyPreviousEnvelope: integrationSecrets.rotationKeyPreviousEnvelope,
          previousKeyVersion: integrationSecrets.previousKeyVersion,
          previousValidUntil: integrationSecrets.previousValidUntil,
        })
        .from(integrationSecrets)
        .where(and(eq(integrationSecrets.organizationId, organizationId), eq(integrationSecrets.provider, provider)))
        .limit(1)

      if (!row) return null

      const current: VaultPair = {
        routineSecret: decryptFromString(row.routineSecretEnvelope),
        rotationKey: decryptFromString(row.rotationKeyEnvelope),
        keyVersion: row.keyVersion,
      }

      const hasPrevious =
        row.routineSecretPreviousEnvelope !== null &&
        row.rotationKeyPreviousEnvelope !== null &&
        row.previousKeyVersion !== null &&
        row.previousValidUntil !== null

      if (!hasPrevious) {
        return { current, previous: null }
      }

      // After grace window expires, surface as no-previous so callers don't
      // accept downgrade-aged signatures.
      if (row.previousValidUntil !== null && row.previousValidUntil.getTime() < Date.now()) {
        return { current, previous: null }
      }

      return {
        current,
        previous: {
          routineSecret: decryptFromString(row.routineSecretPreviousEnvelope as string),
          rotationKey: decryptFromString(row.rotationKeyPreviousEnvelope as string),
          keyVersion: row.previousKeyVersion as number,
          validUntil: row.previousValidUntil as Date,
        },
      }
    },

    async rotate(provider, next, previousValidUntil) {
      const [existing] = await db
        .select({
          routineSecretEnvelope: integrationSecrets.routineSecretEnvelope,
          rotationKeyEnvelope: integrationSecrets.rotationKeyEnvelope,
          keyVersion: integrationSecrets.keyVersion,
        })
        .from(integrationSecrets)
        .where(and(eq(integrationSecrets.organizationId, organizationId), eq(integrationSecrets.provider, provider)))
        .limit(1)

      if (!existing) {
        throw new Error(`integrations/vault: cannot rotate — no existing secret for provider=${provider}`)
      }

      // Strict monotonic — same version is also rejected to surface accidental
      // double-rotation. `signRequest`/`verifyRequest` allow same-version
      // retries, but persisting a same-version rotation would lose the prior
      // material so we reject up front.
      if (next.keyVersion <= existing.keyVersion) {
        throw new Error(
          `integrations/vault: rotation rejected — next.keyVersion=${next.keyVersion} not greater than current=${existing.keyVersion}`,
        )
      }

      await db
        .update(integrationSecrets)
        .set({
          routineSecretEnvelope: encryptToString(next.routineSecret),
          rotationKeyEnvelope: encryptToString(next.rotationKey),
          keyVersion: next.keyVersion,
          routineSecretPreviousEnvelope: existing.routineSecretEnvelope,
          rotationKeyPreviousEnvelope: existing.rotationKeyEnvelope,
          previousKeyVersion: existing.keyVersion,
          previousValidUntil,
        })
        .where(and(eq(integrationSecrets.organizationId, organizationId), eq(integrationSecrets.provider, provider)))
    },
  }
}

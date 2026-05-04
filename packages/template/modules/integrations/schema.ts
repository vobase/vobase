/**
 * `integrations` module schema — encrypted-at-rest secret storage for
 * platform-managed integrations (currently `vobase-platform` for managed
 * WhatsApp channels). One row per (provider, organization). Sole writer is
 * `service/vault.ts`.
 *
 * Cross-module callers read secrets via `service/vault.ts` (NOT directly).
 *
 * The envelope shape is the four-tuple from `@vobase/core` envelope
 * encryption (`{ kekVersion, dekCiphertext, payloadCiphertext, iv, tag }`)
 * stored as base64 — kept opaque-stringly here so a KEK rotation can re-wrap
 * DEKs without touching the schema.
 */

import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { check, index, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { integrationsPgSchema } from '~/runtime'

export const integrationSecrets = integrationsPgSchema.table(
  'secrets',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    provider: text('provider').notNull(),
    /**
     * Two-key rotation contract material — `routine` for steady-state signing,
     * `rotation` rolled per `keyVersion`. Both encrypted as opaque envelopes.
     */
    routineSecretEnvelope: text('routine_secret_envelope').notNull(),
    rotationKeyEnvelope: text('rotation_key_envelope').notNull(),
    keyVersion: integer('key_version').notNull().default(1),
    /** Previous pair held during rotation grace; cleared after expiry. */
    routineSecretPreviousEnvelope: text('routine_secret_previous_envelope'),
    rotationKeyPreviousEnvelope: text('rotation_key_previous_envelope'),
    previousKeyVersion: integer('previous_key_version'),
    previousValidUntil: timestamp('previous_valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uq_integration_secrets_org_provider').on(t.organizationId, t.provider),
    index('idx_integration_secrets_provider').on(t.provider),
    check('integration_secrets_provider_check', sql`provider IN ('vobase-platform')`),
  ],
)

export interface IntegrationSecretRow {
  id: string
  organizationId: string
  provider: string
  routineSecretEnvelope: string
  rotationKeyEnvelope: string
  keyVersion: number
  routineSecretPreviousEnvelope: string | null
  rotationKeyPreviousEnvelope: string | null
  previousKeyVersion: number | null
  previousValidUntil: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Seed helper for `infra.channels_log` rows.
 *
 * Used by the `freeform-*.integration.test.ts` suite to plant an inbound row
 * with a backdated `createdAt` so `checkWithin24h` flips between the freeform
 * and template wire routes.
 *
 * `infra.channels_log` has no `organization_id` column — tenant isolation
 * relies on globally-unique E.164 phone numbers (see within-24h.ts). The
 * helper accepts `organizationId` for symmetry with other seed helpers but
 * never writes it.
 */

import { channelsLog } from '@vobase/core'

interface SeedChannelsLogInboundInput {
  phone: string
  channel?: string
  createdAt: Date
  to?: string
  content?: string
}

/**
 * Insert a single `direction='inbound'` row into `infra.channels_log` with an
 * explicit `createdAt`. Defaults `channel='whatsapp'`, `to='+15550000000'`
 * because both columns are NOT NULL but irrelevant to the within-24h lookup
 * (which keys on `from` + `channel` + `direction` + `created_at`).
 *
 * Typed as `unknown` for the db handle because tests pass the raw
 * `connectTestDb().db` (drizzle 1.0 postgres-js client) which is structurally
 * compatible with the `ScopedDb` alias used in production code but doesn't
 * match the exact `PostgresJsDatabase` generic without a cast.
 */
export async function seedChannelsLogInbound(db: unknown, input: SeedChannelsLogInboundInput): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle generic loose in test helper
  await (db as any).insert(channelsLog).values({
    channel: input.channel ?? 'whatsapp',
    direction: 'inbound',
    from: input.phone,
    to: input.to ?? '+15550000000',
    status: 'received',
    content: input.content ?? null,
    createdAt: input.createdAt,
  })
}

/**
 * Top-level seed entry point — orchestrates module seeds in dependency order:
 * contacts → team → drive → agents → messaging → changes.
 *
 * The organization row is inserted here first so every module seed receives
 * the same `organizationId` at runtime rather than reading a compile-time
 * constant. On real deploys `PLATFORM_TENANT_ID` is stamped by the
 * provisioning pipeline; a bare `db:reset` without the env var generates a
 * fresh nanoid so no literal id is ever hard-coded.
 *
 * Idempotent: running twice produces no duplicate rows (ON CONFLICT DO NOTHING in each module seed).
 *
 * Usage: DATABASE_URL=postgres://... bun run db:seed
 */

import { authOrganization } from '@auth/schema'
import { seed as seedAgents } from '@modules/agents/seed'
import { seed as seedChanges } from '@modules/changes/seed'
import { seed as seedContacts } from '@modules/contacts/seed'
import { seed as seedDrive } from '@modules/drive/seed'
import { seed as seedMessaging } from '@modules/messaging/seed'
import { seed as seedTeam } from '@modules/team/seed'
import { createNanoid } from '@vobase/core'
import { drizzle } from 'drizzle-orm/postgres-js'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const db = drizzle(url)

  // Derive the org id from the environment (platform-stamped on real deploys)
  // or generate a fresh nanoid so a bare `db:reset` never hard-codes an id.
  const organizationId = process.env.PLATFORM_TENANT_ID?.trim() || createNanoid()()
  const orgName = process.env.VITE_PLATFORM_TENANT_NAME?.trim() || 'Meridian'
  const orgSlug = process.env.VITE_PLATFORM_TENANT_SLUG?.trim() || 'meridian'

  console.log('Seeding organization...')
  const d = db as unknown as {
    insert: (t: unknown) => {
      values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
    }
  }
  await d.insert(authOrganization).values({ id: organizationId, name: orgName, slug: orgSlug }).onConflictDoNothing()

  const ctx = { organizationId }

  console.log('Seeding contacts...')
  await seedContacts(db, ctx)

  console.log('Seeding team...')
  await seedTeam(db, ctx)

  console.log('Seeding drive...')
  await seedDrive(db, ctx)

  console.log('Seeding agents...')
  await seedAgents(db, ctx)

  console.log('Seeding messaging...')
  await seedMessaging(db, ctx)

  console.log('Seeding changes...')
  await seedChanges(db, ctx)

  console.log('Seed complete.')
  await (db.$client as { end?: () => Promise<void> }).end?.()
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

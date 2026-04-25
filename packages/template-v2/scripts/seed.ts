/**
 * Top-level seed entry point — orchestrates module seeds in dependency order:
 * contacts → team → drive → agents → messaging.
 *
 * Idempotent: running twice produces no duplicate rows (ON CONFLICT DO NOTHING in each module seed).
 *
 * Usage: DATABASE_URL=postgres://... bun run db:seed
 */

import { seed as seedAgents } from '@modules/agents/seed'
import { seed as seedContacts } from '@modules/contacts/seed'
import { seed as seedDrive } from '@modules/drive/seed'
import { seed as seedMessaging } from '@modules/messaging/seed'
import { seed as seedTeam } from '@modules/team/seed'
import { drizzle } from 'drizzle-orm/postgres-js'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const db = drizzle(url)

  console.log('Seeding contacts...')
  await seedContacts(db)

  console.log('Seeding team...')
  await seedTeam(db)

  console.log('Seeding drive...')
  await seedDrive(db)

  console.log('Seeding agents...')
  await seedAgents(db)

  console.log('Seeding messaging...')
  await seedMessaging(db)

  console.log('Seed complete.')
  await (db.$client as { end?: () => Promise<void> }).end?.()
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

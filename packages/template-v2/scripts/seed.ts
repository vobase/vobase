/**
 * Top-level seed entry point — orchestrates module seeds in dependency order:
 * contacts → drive → agents → inbox (spec §4.3).
 *
 * Idempotent: running twice produces no duplicate rows (ON CONFLICT DO NOTHING in each module seed).
 *
 * Usage: DATABASE_URL=postgres://... bun run db:seed
 */

import { drizzle } from 'drizzle-orm/postgres-js'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const db = drizzle(url)

  console.log('Seeding contacts...')
  const { seed: seedContacts } = await import('@modules/contacts/seed')
  await seedContacts(db)

  console.log('Seeding drive...')
  const { seed: seedDrive } = await import('@modules/drive/seed')
  await seedDrive(db)

  console.log('Seeding agents...')
  const { seed: seedAgents } = await import('@modules/agents/seed')
  await seedAgents(db)

  console.log('Seeding inbox...')
  const { seed: seedInbox } = await import('@modules/inbox/seed')
  await seedInbox(db)

  console.log('Seed complete.')
  await (db.$client as { end?: () => Promise<void> }).end?.()
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

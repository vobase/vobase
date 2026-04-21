/**
 * pgSchema instances for the five template-v2 domain modules. Keep together so
 * the Drizzle schema glob in `drizzle.config.ts` picks them up in one place.
 *
 * Order matters for cross-schema FKs during `db:push`:
 *   contacts → team → inbox → agents → drive
 */
import { pgSchema } from 'drizzle-orm/pg-core'

export const contactsPgSchema = pgSchema('contacts')
export const teamPgSchema = pgSchema('team')
export const inboxPgSchema = pgSchema('inbox')
export const agentsPgSchema = pgSchema('agents')
export const drivePgSchema = pgSchema('drive')

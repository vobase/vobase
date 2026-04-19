/**
 * pgSchema instances for the four template-v2 modules. Keep together so the
 * Drizzle schema glob in `drizzle.config.ts` picks them up in one place.
 *
 * Order matters for cross-schema FKs during `db:push`:
 *   contacts → inbox → agents → drive
 */
import { pgSchema } from 'drizzle-orm/pg-core'

export const contactsPgSchema = pgSchema('contacts')
export const inboxPgSchema = pgSchema('inbox')
export const agentsPgSchema = pgSchema('agents')
export const drivePgSchema = pgSchema('drive')

import { pgSchema } from 'drizzle-orm/pg-core'

/** Auth schema — user, session, account, verification, apikey, organization, member, invitation, team, team_member */
export const authPgSchema = pgSchema('auth')

/**
 * Better-auth config consumed ONLY by the better-auth CLI for schema
 * generation (`bun run gen:auth`). It is never imported at runtime —
 * `createAuth` in `./index.ts` is the real config.
 *
 * The CLI needs a top-level `export const auth` to introspect. This file
 * shares its schema-contributing plugin list with the runtime config via
 * `buildAuthPlugins`, so the generated `./schema.ts` can never diverge from
 * what the runtime expects.
 */

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

import { buildAuthPlugins } from './plugins'

export const auth = betterAuth({
  // The CLI introspects plugin definitions, not the database — `generate`
  // never dereferences the db instance, so a stub declaring the `pg` dialect
  // is all it needs.
  database: drizzleAdapter({} as never, { provider: 'pg' }),
  emailAndPassword: { enabled: false },
  plugins: buildAuthPlugins({
    multiOrg: true,
    sendVerificationOTP: async () => {},
    sendInvitationEmail: async () => {},
  }),
})
